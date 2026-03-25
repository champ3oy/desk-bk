import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ToolDefinition } from './tools.factory';

export interface AgentResponse {
  content?: string;
  action: 'REPLY' | 'ESCALATE' | 'IGNORE' | 'AUTO_RESOLVE';
  escalationReason?: string;
  escalationSummary?: string;
  confidence: number;
  metadata: {
    tokenUsage: any;
    knowledgeBaseUsed: boolean;
    performanceMs: number;
    toolCalls: string[];
  };
}

export async function runReActAgent(params: {
  messages: BaseMessage[];
  tools: ToolDefinition[];
  mainModel: BaseChatModel;
  fastModel: BaseChatModel;
  requestComplexity: 'SIMPLE' | 'COMPLEX';
  totalStart: number;
  kbUsed: boolean;
  smartCacheService?: any;
  lastUserMessage?: any;
  organizationId: string;
}): Promise<AgentResponse> {
  const {
    messages,
    tools,
    mainModel,
    fastModel,
    requestComplexity,
    totalStart,
    organizationId,
    smartCacheService,
    lastUserMessage,
  } = params;
  let { kbUsed } = params;

  const MAX_TURNS = requestComplexity === 'SIMPLE' ? 2 : 3;
  let turn = 0;
  const executedTools: string[] = [];

  const bindToolsToModel = (model: any) => {
    return (model as any).bindTools
      ? (model as any).bindTools(
          tools.map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema,
          })),
        )
      : model;
  };

  const fastModelWithTools = bindToolsToModel(fastModel);
  const mainModelWithTools = bindToolsToModel(mainModel);

  try {
    while (turn < MAX_TURNS) {
      turn++;
      console.log(`[ReAct Loop] Turn ${turn}`);

      if (turn === MAX_TURNS) {
        messages.push(
          new HumanMessage(
            'NOTE: You have reached the maximum number of steps. Based on the information you have, please provide your final response to the user now. Do not call any more tools.',
          ),
        );
      }

      const isSimple = requestComplexity === 'SIMPLE';
      const selectedModelProxy = isSimple
        ? fastModelWithTools
        : mainModelWithTools;

      console.log(
        `[ReAct Loop] Using ${isSimple ? 'Flash (Simple)' : 'Pro (Complex)'} model for turn ${turn}`,
      );

      const aiResponse = await selectedModelProxy.invoke(messages);
      messages.push(aiResponse);

      if (
        turn === MAX_TURNS &&
        aiResponse.content &&
        typeof aiResponse.content === 'string' &&
        aiResponse.content.trim().length > 0
      ) {
        return {
          action: 'REPLY',
          content: aiResponse.content,
          confidence: 100,
          metadata: {
            tokenUsage: aiResponse.usage_metadata,
            knowledgeBaseUsed: kbUsed,
            performanceMs: Date.now() - totalStart,
            toolCalls: executedTools,
          },
        };
      }

      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        const toolPromises = aiResponse.tool_calls.map(async (toolCall) => {
          executedTools.push(toolCall.name);
          const toolDef = tools.find((t) => t.name === toolCall.name);

          if (!toolDef) {
            return new ToolMessage({
              tool_call_id: toolCall.id!,
              content: 'Tool not found.',
            });
          }

          if (toolCall.name === 'search_knowledge_base') kbUsed = true;

          try {
            const result = await toolDef.func(toolCall.args);
            return {
              tool_call_id: toolCall.id!,
              content:
                typeof result === 'string' ? result : JSON.stringify(result),
              rawResult: result,
            };
          } catch (e) {
            console.error(`[Tool Error] ${toolCall.name}:`, e);
            return new ToolMessage({
              tool_call_id: toolCall.id!,
              content: 'Error executing tool: ' + e.message,
            });
          }
        });

        const toolResults = await Promise.all(toolPromises);

        for (const res of toolResults) {
          if (res instanceof ToolMessage) {
            messages.push(res);
            continue;
          }

          const raw = res.rawResult;
          if (raw && typeof raw === 'object' && raw.__action) {
            if (raw.__action === 'ESCALATE') {
              return {
                action: 'ESCALATE',
                escalationReason: raw.reason,
                escalationSummary: raw.summary,
                confidence: 100,
                metadata: {
                  tokenUsage: aiResponse.usage_metadata,
                  knowledgeBaseUsed: kbUsed,
                  performanceMs: Date.now() - totalStart,
                  toolCalls: executedTools,
                },
              };
            }
            if (raw.__action === 'REPLY') {
              if (
                raw.message &&
                raw.message.length > 50 &&
                smartCacheService &&
                lastUserMessage &&
                (!lastUserMessage.attachments ||
                  lastUserMessage.attachments.length === 0)
              ) {
                smartCacheService
                  .store(lastUserMessage.content, raw.message, organizationId)
                  .catch((e) =>
                    console.error('[SmartCache] Async store failed:', e),
                  );
              }

              return {
                action: 'REPLY',
                content: raw.message,
                confidence: 100,
                metadata: {
                  tokenUsage: aiResponse.usage_metadata,
                  knowledgeBaseUsed: kbUsed,
                  performanceMs: Date.now() - totalStart,
                  toolCalls: executedTools,
                },
              };
            }
          }

          messages.push(
            new ToolMessage({
              tool_call_id: res.tool_call_id,
              content: res.content,
            }),
          );
        }
      } else {
        const content =
          typeof aiResponse.content === 'string' ? aiResponse.content : '';

        const hallucinatedCall = content.match(
          /send_final_reply\s*\(\s*message\s*=\s*(["'])([\s\S]*?)\1\s*\)/,
        );

        if (hallucinatedCall) {
          console.log(
            '[ReAct Loop] Detected hallucinated tool call in text. Fixing...',
          );
          return {
            action: 'REPLY',
            content: hallucinatedCall[2],
            confidence: 85,
            metadata: {
              tokenUsage: aiResponse.usage_metadata,
              knowledgeBaseUsed: kbUsed,
              performanceMs: Date.now() - totalStart,
              toolCalls: executedTools.concat(['send_final_reply_fixed']),
            },
          };
        }

        if (content) {
          return {
            action: 'REPLY',
            content: content,
            confidence: 90,
            metadata: {
              tokenUsage: aiResponse.usage_metadata,
              knowledgeBaseUsed: kbUsed,
              performanceMs: Date.now() - totalStart,
              toolCalls: executedTools,
            },
          };
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[ReAct Loop] Error:`, err);
    return {
      action: 'ESCALATE',
      escalationReason: 'Agent Error: ' + err.message,
      confidence: 0,
      metadata: {
        tokenUsage: {},
        knowledgeBaseUsed: kbUsed,
        performanceMs: Date.now() - totalStart,
        toolCalls: executedTools,
      },
    };
  }

  return {
    action: 'ESCALATE',
    escalationReason: 'Agent loop exhausted without resolution.',
    confidence: 0,
    metadata: {
      tokenUsage: {},
      knowledgeBaseUsed: kbUsed,
      performanceMs: Date.now() - totalStart,
      toolCalls: executedTools,
    },
  };
}
