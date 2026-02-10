import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';
import { AIModelFactory } from '../../ai-model.factory';
import { z } from 'zod';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from '@langchain/core/messages';
import {
  TicketStatus,
  TicketPriority,
} from '../../../tickets/entities/ticket.entity';

// Initial System Prompt - ReAct Instructions
const REACT_SYSTEM_PROMPT = `You are an expert customer support agent for our company. Your goal is to resolve customer issues efficiently and professionally.

# CORE RESPONSIBILITIES
1.  **Understand**: Read the customer's message and context carefully.
2.  **Research**: Use tools to find information (Knowledge Base, Customer History) before answering.
3.  **Act**: If appropriate, update the ticket (e.g., set priority) or escalate.
4.  **Respond**: Provide a helpful, concise answer to the customer.

# TOOL USAGE GUIDELINES
-   **Always** check 'search_knowledge_base' if the user asks a policy or technical question. Do not hallucinate policies.
-   **Always** check 'get_customer_context' if you need to know who the user is (e.g. VIP status, recent orders).
-   If the user is angry or the issue is complex, use 'escalate_ticket'.
-   If the user asks about a specific topic (e.g., "Billing"), use 'update_ticket_attributes' to tag it.
-   **Final Step**: You must ALWAYS call 'send_final_reply' to send your message to the user, OR 'escalate_ticket' to hand off.
-   **IMPORTANT**: Do NOT write the function call (e.g. "send_final_reply(...)") in the message text. You must use the tool/function calling feature.
-   **Conversation Closure**: If the user says "Thanks" or indicates the issue is resolved, do NOT reply "You're welcome". Just stop (return empty text, no tool calls).

# TONE & STYLE
-   Professional, empathetic, and concise.
-   No "Robot" speak. Be human.
-   No signatures (they are added automatically).
`;

/**
 * Build a dynamic system prompt based on organization AI configuration
 */
export function buildSystemPrompt(
  org: Organization,
  channel?: string,
  customerName?: string,
): string {
  const basePrompt = org.aiPersonalityPrompt || REACT_SYSTEM_PROMPT;

  const instructions: string[] = [];

  // Formality
  if (org.aiFormality !== undefined) {
    if (org.aiFormality < 30)
      instructions.push('- Use casual, conversational language.');
    else if (org.aiFormality > 70)
      instructions.push('- Maintain a formal, professional tone.');
  }

  // Empathy
  if (org.aiEmpathy !== undefined && org.aiEmpathy > 70) {
    instructions.push('- Show high empathy. Acknowledge feelings first.');
  }

  // Length
  if (org.aiResponseLength !== undefined) {
    if (org.aiResponseLength < 30)
      instructions.push('- Keep responses extremely brief.');
    else if (org.aiResponseLength > 70)
      instructions.push('- Provide detailed, comprehensive explanations.');
  }

  // Channel specifics
  if (channel !== 'email') {
    instructions.push(
      '- This is a chat/messaging channel. Keep it short and conversational.',
    );
    instructions.push('- Do NOT use complex markdown headers.');
  } else {
    instructions.push('- This is an email. Use standard email formatting.');
  }

  if (instructions.length > 0) {
    return `${basePrompt}\n\n# TONE GUIDELINES\n${instructions.join('\n')}`;
  }

  return basePrompt;
}

export type AgentResponse = {
  content?: string;
  action: 'REPLY' | 'ESCALATE' | 'IGNORE'; // Added IGNORE
  escalationReason?: string;
  escalationSummary?: string; // Added short summary for human agent
  confidence: number;
  metadata: {
    tokenUsage: any;
    knowledgeBaseUsed: boolean;
    performanceMs: number;
    toolCalls: string[];
  };
};

export const draftResponse = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: any, // KnowledgeBaseService
  customersService: any, // CustomersService
  userId: string,
  userRole: UserRole,
  organizationId: string,
  additionalContext?: string,
  channel?: string,
  isWaitingForNewTopicCheck = false,
): Promise<AgentResponse> => {
  const totalStart = Date.now();
  console.log(`[ReAct Agent] Started for ticket ${ticket_id}`);

  // 1. Fetch Context
  const [ticket, org] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    organizationsService.findOne(organizationId),
  ]);

  if (!ticket || !org) {
    throw new Error('Ticket or Organization not found');
  }

  // Fetch threads (Summary Only for initial context, or full? For ReAct, last 10 messages is safer/cheaper)
  // We'll fetch all threads but only use the last few messages in the initial prompt to save tokens.
  const threads = await threadsService.findAll(
    ticket_id,
    organizationId,
    userId,
    userRole,
  );
  const threadsWithMessages = await Promise.all(
    threads.map(async (thread) => {
      const messages = await threadsService.getMessages(
        thread._id.toString(),
        organizationId,
        userId,
        userRole,
      );
      return { ...thread.toObject(), messages };
    }),
  );

  // Flatten messages for context
  const allMessages = threadsWithMessages
    .flatMap((t) => t.messages)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  // Take last 15 messages for context window
  const recentMessages = allMessages.slice(-15);

  // 2. Define Tools
  const tools = [
    {
      name: 'search_knowledge_base',
      description:
        'Search the internal knowledge base for policies, how-to guides, and troubleshooting steps.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'The search query (e.g., "refund policy", "reset password")',
          ),
      }),
      func: async ({ query }: { query: string }) => {
        try {
          if (!knowledgeBaseService) return 'Knowledge Base not available.';
          console.log(`[Tool] Searching KB: ${query}`);
          const results = await knowledgeBaseService.retrieveRelevantContent(
            query,
            organizationId,
            2,
          );
          return results || 'No relevant results found.';
        } catch (error) {
          console.error(`[Tool] Error searching KB:`, error);
          return `Error searching Knowledge Base: ${error.message}. Please try again or escalate if needed.`;
        }
      },
    },
    {
      name: 'get_customer_context',
      description:
        'Get details about the customer (email, name, phone, company).',
      schema: z.object({}), // No args needed, implied from context
      func: async () => {
        console.log(`[Tool] Getting customer context`);
        const customerId = (ticket.customerId as any)._id || ticket.customerId;
        if (!customerId || !customersService)
          return 'Customer info unavailable.';
        const customer = await customersService.findOne(
          customerId.toString(),
          organizationId,
        );
        return JSON.stringify({
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: customer.phone,
          company: customer.company,
          externalId: customer.externalId,
        });
      },
    },
    {
      name: 'update_ticket_attributes',
      description:
        'Update ticket priority, status, or tags. Use this to organize the ticket.',
      schema: z.object({
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        tags: z.array(z.string()).optional(),
      }),
      func: async ({
        priority,
        tags,
      }: {
        priority?: string;
        tags?: string[];
      }) => {
        console.log(`[Tool] Updating ticket attributes`);
        const updateData: any = {};

        // Normalization for priority
        if (priority) {
          const p = priority.toLowerCase();
          if (['low', 'medium', 'high', 'urgent'].includes(p)) {
            updateData.priority = p;
          } else {
            // Fallback or ignore invalid priority? Let's ignore to be safe.
            console.warn(`[Tool] Invalid priority input: ${priority}`);
          }
        }

        // Tags logic
        if (tags && tags.length > 0) {
          const tagIds = await ticketsService.resolveTags(tags, organizationId);
          if (tagIds && tagIds.length > 0) {
            updateData.tagIds = tagIds.map((id) => id.toString());
          } else {
            console.warn(`[Tool] No valid tags found for input: ${tags}`);
          }
        }

        if (Object.keys(updateData).length > 0) {
          await ticketsService.update(
            ticket_id,
            updateData,
            userId,
            userRole,
            organizationId,
          );
          return 'Ticket updated successfully.';
        }
        return 'No updates applied.';
      },
    },
    {
      name: 'escalate_ticket',
      description:
        'Escalate the ticket to a human agent. Use this if you cannot solve the issue.',
      schema: z.object({
        reason: z.string().describe('Reason for escalation (internal logging)'),
        summary: z
          .string()
          .describe(
            'A brief summary of the user issue for the human agent (e.g. "User asking for refund on order #123")',
          ),
      }),
      func: async ({
        reason,
        summary,
      }: {
        reason: string;
        summary: string;
      }) => {
        console.log(`[Tool] Escalating ticket: ${reason}`);
        return { __action: 'ESCALATE', reason, summary };
      },
    },
    {
      name: 'send_final_reply',
      description: 'Send the final response to the user.',
      schema: z.object({
        message: z.string().describe('The message content to send.'),
      }),
      func: async ({ message }: { message: string }) => {
        console.log(`[Tool] Sending final reply`);
        return { __action: 'REPLY', message };
      },
    },
    {
      name: 'create_new_ticket',
      description: 'Create a NEW ticket for a separate issue.',
      schema: z.object({
        subject: z.string(),
        description: z.string(),
      }),
      func: async ({
        subject,
        description,
      }: {
        subject: string;
        description: string;
      }) => {
        console.log(`[Tool] Creating new ticket: ${subject}`);
        const newTicket = await ticketsService.create(
          {
            subject,
            description,
            status: TicketStatus.OPEN,
            customerId:
              (ticket.customerId as any)._id?.toString() ||
              ticket.customerId.toString(),
            priority: TicketPriority.MEDIUM,
          },
          organizationId,
          channel,
        );
        return {
          __action: 'REPLY',
          message: `I've created a new ticket (#${(newTicket as any).displayId}) for "${subject}".`,
        };
      },
    },
  ];

  // 3. Initialize Model and Messages
  // 3. Initialize Models
  // We separate "Fast" tasks (Intent) from "Reasoning" tasks (ReAct Loop)

  // Fast Model: Use 'gemini-3-flash-preview' by default for speed/cost, unless overridden
  const fastModel = AIModelFactory.create(configService, {
    model:
      configService.get<string>('ai.fastModel') || 'gemini-3-flash-preview',
  });

  // Main Model: Use the configured app default (likely Pro) or specific 'ai.reasoningModel'
  const mainModel = AIModelFactory.create(configService, {
    model: configService.get<string>('ai.reasoningModel'), // If undefined, factory uses default AI_MODEL/config
  });

  const modelWithTools = (mainModel as any).bindTools
    ? (mainModel as any).bindTools(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          schema: t.schema,
        })),
      )
    : mainModel;

  const systemPrompt = buildSystemPrompt(
    org,
    channel,
    (ticket.customerId as any).firstName,
  );

  // 4. Intent Classification Check (Stop Infinite Loops)
  // We check the LAST user message to see if it's gratitude or closure.
  // We use the same model but with a specific prompt.
  const lastUserMessage = recentMessages[recentMessages.length - 1];
  if (lastUserMessage && lastUserMessage.authorType === 'customer') {
    // Context: Last 3 customer messages to catch compound thoughts (e.g. "Thanks" + "But I have an issue")
    const recentCustomerText = recentMessages
      .filter((m) => m.authorType === 'customer')
      .slice(-3)
      .map((m) => m.content)
      .join('\n');

    const intentPrompt = `
      Analyze the following recent customer messages:
      "${recentCustomerText}"
      
      Classify the OVERALL intent of the user into one of these categories:
      - GRATITUDE: The user is ONLY saying thanks, you're welcome, or expressing appreciation (e.g. "Thanks!", "Great help").
      - CLOSURE: The user is ONLY ending the conversation (e.g. "Bye", "Have a good day", "That's all").
      - AFFIRMATIVE: A simple yes/ok answer to a question (e.g. "Yes", "Okay", "Sure").
      - INQUIRY: The user is asking a question, reporting an issue, or continuing the conversation.
      - OTHER: Anything else.
      
      Return ONLY the category name.
      `;

    const intentResponse = await fastModel.invoke(intentPrompt);
    const intent =
      typeof intentResponse.content === 'string'
        ? intentResponse.content
            .trim()
            .toUpperCase()
            .replace(/[^A-Z]/g, '')
        : 'OTHER';

    console.log(
      `[ReAct Agent] Intent Check: ${intent} for "${lastUserMessage.content}"`,
    );

    if (['GRATITUDE', 'CLOSURE'].includes(intent)) {
      return {
        action: 'IGNORE',
        content: '',
        confidence: 100,
        metadata: {
          tokenUsage: intentResponse.usage_metadata,
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['intent_check'],
        },
      };
    }
  }

  // Build Multimodal History
  const historyMessages: BaseMessage[] = [];

  // Helper to fetch image as base64
  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
      console.log(`[AI Agent] Fetching image for context: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(
          `[AI Agent] Failed to fetch image: ${response.statusText}`,
        );
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (e) {
      console.warn(`[AI Agent] Failed to download image context: ${url}`, e);
      return null;
    }
  };

  for (const msg of recentMessages) {
    const role = msg.authorType === 'customer' ? 'user' : 'assistant';
    const contentParts: any[] = [];

    // Add text content (default to empty string if missing to avoid validation errors, though [Attachment] usually present)
    const textContent = msg.content || '';
    if (textContent) {
      contentParts.push({ type: 'text', text: textContent });
    }

    // Add Image attachments
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        // Only add images for now
        if (att.mimeType && att.mimeType.startsWith('image/')) {
          // Use the public Vercel Blob URL directly
          if (att.path && att.path.startsWith('http')) {
            const base64Data = await fetchImageAsBase64(att.path);
            if (base64Data) {
              contentParts.push({
                type: 'image_url',
                image_url: {
                  url: base64Data,
                },
              });
            }
          }
        }
      }
    }

    // fallback for empty content (rare)
    if (contentParts.length === 0) {
      contentParts.push({ type: 'text', text: '[Empty Message]' });
    }

    if (role === 'user') {
      historyMessages.push(new HumanMessage({ content: contentParts }));
    } else {
      historyMessages.push(new AIMessage({ content: contentParts }));
    }
  }

  const contextInstruction = `
Context:
- Ticket ID: ${ticket.displayId || ticket._id}
- Subject: ${ticket.subject}
- Status: ${ticket.status}
- Current Priority: ${ticket.priority}

${additionalContext ? `Additional Instruction: ${additionalContext}` : ''}
${isWaitingForNewTopicCheck ? 'Note: User is in escalation buffer. Check if this is a new topic.' : ''}

Please decide on the next best action.
`;

  // Message Buffer
  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...historyMessages,
    new HumanMessage(contextInstruction),
  ];

  // 4. ReAct Loop
  const MAX_TURNS = 5;
  let turn = 0;
  const finalResult: AgentResponse = {
    action: 'ESCALATE',
    confidence: 0,
    metadata: {
      tokenUsage: {},
      knowledgeBaseUsed: false,
      performanceMs: 0,
      toolCalls: [],
    },
  };
  const executedTools: string[] = [];
  let kbUsed = false;

  try {
    while (turn < MAX_TURNS) {
      turn++;
      console.log(`[ReAct Loop] Turn ${turn}`);

      // Force a reply if we're at the limit
      if (turn === MAX_TURNS) {
        console.log('[ReAct Loop] Max turns reached. Forcing final reply.');
        messages.push(
          new HumanMessage(
            'NOTE: You have reached the maximum number of steps. Based on the information you have, please provide your final response to the user now. Do not call any more tools.',
          ),
        );
      }

      // Invoke Model
      const aiResponse = await modelWithTools.invoke(messages);
      messages.push(aiResponse);

      // FORCE REPLY ON MAX TURNS: If we are at the limit and have content, return it.
      // This prevents the loop from exiting and falling through to escalation when a summary was generated.
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

      // Check for Tool Calls
      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        // Execute Tools
        // Execute Tools in Parallel where possible
        // We'll map promises for all tool calls
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

            // Check for Terminal Actions (Magic values returned by func)
            // Note: In parallel exec, if multiple return terminal actions, we pick the first one roughly?
            // Since we return inside the loop, we need to handle this carefully.
            // We will return the result object as is, and process it after all resolve.
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

        // Process results for Terminal Actions or add to history
        for (const res of toolResults) {
          // If it's a ToolMessage already (error), add it
          if (res instanceof ToolMessage) {
            messages.push(res);
            continue;
          }

          // Check for Magic Terminal Action
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

          // Standard Tool Result
          messages.push(
            new ToolMessage({
              tool_call_id: res.tool_call_id,
              content: res.content,
            }),
          );
        }
      } else {
        // AI returned text without tool calls -> Treat as final reply attempt (or confusion)
        // Ideally we force tools, but sometimes models chat.
        // We'll treat plain text as a REPLY.
        const content =
          typeof aiResponse.content === 'string' ? aiResponse.content : '';

        // FIX: Detect hallucinated tool calls (text that looks like code)
        // Matches: send_final_reply(message="...") or send_final_reply(message='...')
        // This handles cases where smaller models write the code instead of calling the tool.
        const hallucinatedCall = content.match(
          /send_final_reply\s*\(\s*message\s*=\s*(["'])([\s\S]*?)\1\s*\)/,
        );

        if (hallucinatedCall) {
          console.log(
            '[ReAct Loop] Detected hallucinated tool call in text. Fixing...',
          );
          return {
            action: 'REPLY',
            content: hallucinatedCall[2], // The captured message inside quotes
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
            confidence: 90, // Passing confidence for direct replies (assumes the model knows what it's doing)
            metadata: {
              tokenUsage: aiResponse.usage_metadata,
              knowledgeBaseUsed: kbUsed,
              performanceMs: Date.now() - totalStart,
              toolCalls: executedTools,
            },
          };
        }
        break; // Empty response?
      }
    }
  } catch (err) {
    console.error(`[ReAct Loop] Error:`, err);
    return {
      action: 'IGNORE', // Fail silently on internal error
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

  // Fallback if loop ends without decision
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
};
