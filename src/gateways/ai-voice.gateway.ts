import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { OrganizationsService } from '../organizations/organizations.service';
import { KnowledgeBaseService } from '../ai/knowledge-base.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'ai-voice',
})
export class AiVoiceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private geminiConnections = new Map<string, WebSocket>();

  constructor(
    private configService: ConfigService,
    private organizationsService: OrganizationsService,
    private knowledgeBaseService: KnowledgeBaseService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`Client connected to voice gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected from voice gateway: ${client.id}`);
    const geminiWs = this.geminiConnections.get(client.id);
    if (geminiWs) {
      geminiWs.close();
      this.geminiConnections.delete(client.id);
    }
  }

  @SubscribeMessage('start-session')
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { model?: string; organizationId?: string },
  ) {
    // If already connected, close previous
    if (this.geminiConnections.has(client.id)) {
      this.geminiConnections.get(client.id)?.close();
      this.geminiConnections.delete(client.id);
    }

    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    if (!apiKey) {
      client.emit('error', { message: 'Gemini API Key not found' });
      return;
    }

    const host = 'generativelanguage.googleapis.com';
    const uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    console.log(
      `Connecting to Gemini Bidi API: ${uri.replace(apiKey, 'HIDDEN')}`,
    );

    try {
      // 1. Fetch Organization Context if provided
      let orgContext = '';
      if (data.organizationId) {
        try {
          const org = await this.organizationsService.findOne(
            data.organizationId,
          );
          orgContext = `You are an AI assistant for "${org.name}". 
Your job is to help users with their queries based on the knowledge provided. 
When answering, be professional and concise. `;
        } catch (e) {
          console.warn('Could not fetch org for voice session', e);
        }
      }

      const geminiWs = new WebSocket(uri);

      geminiWs.on('open', async () => {
        console.log(`Connected to Gemini for client ${client.id}`);
        this.geminiConnections.set(client.id, geminiWs);

        // Forced model for Live API
        const targetModel = 'models/gemini-2.5-flash-native-audio-latest';

        const setupMsg = {
          setup: {
            model: targetModel,
            systemInstruction: {
              parts: [
                { text: orgContext || 'You are a helpful AI assistant.' },
              ],
            },
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Charon',
                  },
                },
              },
            },
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'search_knowledge_base',
                    description:
                      'ALWAYS use this tool to answer user questions about the company or specific information. Do not halluncinate answers.',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        query: {
                          type: 'STRING',
                          description:
                            'The search keywords to look up in the knowledge base.',
                        },
                      },
                      required: ['query'],
                    },
                  },
                ],
              },
            ],
          },
        };

        console.log('Sending Gemini Setup:', JSON.stringify(setupMsg));
        geminiWs.send(JSON.stringify(setupMsg));
        client.emit('ai-status', { status: 'connected', model: targetModel });
      });
      geminiWs.on('message', async (dataBuffer: Buffer) => {
        const handleToolCall = async (toolCall: any) => {
          const functionCalls = toolCall.functionCalls || [];
          for (const call of functionCalls) {
            if (call.name === 'search_knowledge_base') {
              const query = call.args.query;
              console.log(`Executing tool: search_knowledge_base("${query}")`);

              const organizationId = data.organizationId;
              let results = 'No information found.';

              if (organizationId) {
                try {
                  const searchResult =
                    await this.knowledgeBaseService.retrieveRelevantContent(
                      query,
                      organizationId,
                    );
                  results = searchResult || 'No relevant documents found.';
                  console.log(`Tool Result: ${results.substring(0, 50)}...`);

                  const toolResponse = {
                    toolResponse: {
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: { result: results },
                        },
                      ],
                    },
                  };

                  if (geminiWs.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify(toolResponse));
                  }
                } catch (err) {
                  console.error('Tool execution failed', err);
                }
              }
            }
          }
        };

        try {
          const response = JSON.parse(dataBuffer.toString());

          if (response.setupComplete) {
            console.log('Gemini Setup Complete');
            client.emit('ai-status', { status: 'ready' });
          }

          if (response.error) {
            console.error('Gemini Internal Error:', response.error);
            client.emit('ai-error', response.error);
          }

          // Handle Server Content (Turn or ToolCall)
          if (response.toolCall) {
            await handleToolCall(response.toolCall);
          } else if (response.serverContent?.toolCall) {
            await handleToolCall(response.serverContent.toolCall);
          } else if (response.serverContent?.modelTurn?.parts) {
            for (const part of response.serverContent.modelTurn.parts) {
              if (part.functionCall) {
                await handleToolCall({
                  functionCalls: [part.functionCall],
                  // Use the ID from the functionCall if available
                  id: part.functionCall.id || 'turn_function_call',
                });
              }
            }
          }

          // Forward the raw response to the client to handle
          client.emit('ai-response', response);
        } catch (e) {
          console.error('Error parsing Gemini message', e);
        }
      });

      geminiWs.on('close', (code, reason) => {
        console.log(
          `Gemini connection closed for ${client.id}. Code: ${code}, Reason: ${reason.toString()}`,
        );
        client.emit('ai-status', {
          status: 'disconnected',
          code,
          reason: reason.toString(),
        });
        this.geminiConnections.delete(client.id);
      });

      geminiWs.on('error', (error) => {
        console.error(`Gemini connection error for ${client.id}:`, error);
        client.emit('ai-error', { message: error.message });
        this.geminiConnections.delete(client.id);
      });
    } catch (e) {
      console.error('Failed to connect to Gemini', e);
      client.emit('error', { message: 'Failed to connect to AI Service' });
    }
  }

  @SubscribeMessage('audio-chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() chunk: { data: string; mimeType?: string },
  ) {
    const geminiWs = this.geminiConnections.get(client.id);
    if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) {
      // console.warn("Gemini WS not open");
      return;
    }

    const payload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: chunk.mimeType || 'audio/pcm;rate=16000',
            data: chunk.data, // Expecting Base64
          },
        ],
      },
    };

    geminiWs.send(JSON.stringify(payload));
  }
}
