import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);
  private client: ElevenLabsClient | undefined;
  private agentId: string | undefined;

  constructor(private configService: ConfigService) {
    this.logger.log(
      `Process Env Keys: ${Object.keys(process.env).filter((k) => k.includes('ELEVENLABS'))}`,
    );
    const apiKey = this.configService.get<string>('ai.elevenLabsApiKey');
    this.agentId = this.configService.get<string>('ai.elevenLabsAgentId');

    if (apiKey) {
      this.client = new ElevenLabsClient({ apiKey });
      this.logger.log(
        `ElevenLabs client initialized with API key starting with: ${apiKey.substring(0, 4)}...`,
      );
    } else {
      this.logger.warn(
        'ELEVENLABS_API_KEY not set. ElevenLabs integration disabled.',
      );
    }

    if (this.agentId) {
      this.logger.log(`ElevenLabs Agent ID loaded: ${this.agentId}`);
    } else {
      this.logger.warn(
        'ELEVENLABS_AGENT_ID not set. Knowledge base updates will fail.',
      );
    }
  }

  async addToKnowledgeBase(
    name: string,
    content: string,
    type: 'text' | 'url' = 'text',
    agentId?: string,
  ): Promise<void> {
    const targetAgentId = agentId || this.agentId;

    this.logger.log(
      `addToKnowledgeBase called for: ${name}, type: ${type}, agentId: ${targetAgentId}`,
    );
    this.logger.log(
      `Client exists: ${!!this.client}, Agent ID: ${targetAgentId}`,
    );

    if (!this.client || !targetAgentId) {
      this.logger.warn(
        'ElevenLabs client or Agent ID not configured. Skipping knowledge base update.',
      );
      return;
    }

    try {
      this.logger.log(
        `Adding document "${name}" to ElevenLabs knowledge base...`,
      );

      let docId: string;

      if (type === 'url') {
        const res =
          await this.client.conversationalAi.knowledgeBase.documents.createFromUrl(
            {
              url: content,
              name, // name is optional but good to have if supported, otherwise just url
            } as any,
          ); // Casting as types might differ slightly
        docId = res.id;
      } else {
        const res =
          await this.client.conversationalAi.knowledgeBase.documents.createFromText(
            {
              text: content,
              name,
            } as any,
          );
        docId = res.id;
      }

      this.logger.log(`Document created with ID: ${docId}`);

      // 1.5. Index the document for RAG
      this.logger.log(`Triggering RAG indexing for document: ${docId}`);
      try {
        await (
          this.client.conversationalAi.knowledgeBase as any
        ).document.computeRagIndex(docId, { model: 'e5_mistral_7b_instruct' });

        // Polling for completion
        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s
        while (attempts < maxAttempts) {
          const statusRes = await (
            this.client.conversationalAi.knowledgeBase as any
          ).document.computeRagIndex(docId, {
            model: 'e5_mistral_7b_instruct',
          });
          this.logger.log(
            `Indexing status for ${docId}: ${statusRes.status} (${statusRes.progressPercentage}%)`,
          );

          if (statusRes.status === 'succeeded') break;
          if (
            ['failed', 'rag_limit_exceeded', 'document_too_small'].includes(
              statusRes.status,
            )
          ) {
            this.logger.warn(`Indexing ended with status: ${statusRes.status}`);
            break;
          }

          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (indexError) {
        this.logger.warn(
          `Failed to trigger RAG indexing: ${indexError.message}`,
        );
        // Continue anyway, as it might already be indexing or have other issues
      }

      // 2. Add to agent and set usage mode
      const agent =
        await this.client.conversationalAi.agents.get(targetAgentId);
      this.logger.log(`Fetched agent config for: ${targetAgentId}`);

      const currentAgentConfig = agent.conversationConfig?.agent as any;
      const currentPromptConfig = currentAgentConfig?.prompt || {};
      const currentKb =
        currentPromptConfig?.knowledgeBase ||
        currentPromptConfig?.knowledge_base ||
        [];

      this.logger.log(
        `Current Knowledge Base has ${currentKb.length} documents.`,
      );

      // Filter out existing document if it was already there (to avoid duplicates)
      const filteredKb = currentKb.filter((item: any) => item.id !== docId);

      const updateResponse = await this.client.conversationalAi.agents.update(
        targetAgentId,
        {
          conversationConfig: {
            ...agent.conversationConfig,
            agent: {
              ...currentAgentConfig,
              prompt: {
                ...currentPromptConfig,
                knowledgeBase: [
                  ...filteredKb,
                  {
                    id: docId,
                    name: name,
                    type: type === 'url' ? 'url' : 'file',
                    usageMode: 'auto',
                  },
                ],
                rag: {
                  ...(currentPromptConfig?.rag || {}),
                  enabled: true,
                  embeddingModel: 'e5_mistral_7b_instruct',
                },
              },
            },
          },
        },
      );

      this.logger.log(
        `Agent updated response status: ${JSON.stringify(updateResponse.name)}`,
      );

      this.logger.log(
        `Successfully added and indexed document ${docId} for agent ${targetAgentId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to add to ElevenLabs knowledge base: ${error.message}`,
        error.stack,
      );
    }
  }

  async getSignedUrl(agentId?: string): Promise<{ signedUrl: string }> {
    const targetAgentId = agentId || this.agentId;

    if (!targetAgentId || !this.client) {
      throw new Error('ElevenLabs not configured (Agent ID or Client missing)');
    }

    try {
      // Direct API call since SDK support for signed URL likely varies or is hidden
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${targetAgentId}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key':
              this.configService.get<string>('ai.elevenLabsApiKey') || '',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to get signed URL: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json();
      return { signedUrl: data.signed_url };
    } catch (error) {
      this.logger.error(`Error getting signed URL: ${error.message}`);
      throw error;
    }
  }

  getConfigStatus(agentId?: string) {
    return {
      apiKeySet: !!this.configService.get<string>('ai.elevenLabsApiKey'),
      agentIdSet: !!(agentId || this.agentId),
      agentId: agentId || this.agentId,
    };
  }

  async createAgent(name: string, prompt?: string): Promise<string> {
    if (!this.client) {
      throw new Error('ElevenLabs client not initialized');
    }

    const agentName = name || 'Support Agent';

    try {
      const agent = await this.client.conversationalAi.agents.create({
        name: agentName,
        conversationConfig: {
          agent: {
            prompt: {
              prompt:
                prompt || `You are a helpful support agent for ${agentName}.`,
              llm: 'gpt-4-turbo',
              temperature: 0.7,
              knowledgeBase: [],
            },
            firstMessage: 'Hello! How can I help you today?',
            language: 'en',
          },
          asr: {
            quality: 'high',
            provider: 'elevenlabs',
          },
          tts: {
            modelId: 'eleven_turbo_v2',
            agentOutputAudioFormat: 'pcm_44100',
          },
        } as any,
      });

      // Handle type mismatch if SDK definition is outdated
      const agentData = agent as any;
      const newAgentId =
        agentData.agentId || agentData.agent_id || agentData.id;

      this.logger.log(
        `Created new ElevenLabs Agent: ${newAgentId} for ${name}`,
      );
      return newAgentId;
    } catch (err: any) {
      this.logger.error(`Failed to create agent: ${err.message}`, err.body);
      throw err;
    }
  }
}
