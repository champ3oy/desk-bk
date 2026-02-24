import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';
import { AIModelFactory } from '../../ai-model.factory';
import { SmartCacheService } from '../../smart-cache.service';
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
-   **Missing Information**: If you cannot find the answer in the Knowledge Base after searching, or if the user's request is ambiguous, use 'ask_customer_for_clarification' to get more details. Do NOT keep searching if the information simply isn't there.
-   **Final Step**: You must ALWAYS call 'send_final_reply' or 'ask_customer_for_clarification' to send your message to the user, OR 'escalate_ticket' to hand off.
-   **IMPORTANT**: Do NOT write the function call (e.g. "send_final_reply(...)") in the message text. You must use the tool/function calling feature.
-   **Conversation Closure**: If the user says "Thanks" or indicates the issue is resolved, STOP IMMEDIATELY. Do NOT send any text. Do NOT call any tools. Return an empty string "". Never explain why you are not responding.

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

    // WhatsApp Name Verification
    if (channel === 'whatsapp' && customerName) {
      const isGenericName =
        /^(whatsapp user|wa user|phone user|customer|\+\d+)$/i.test(
          customerName,
        ) || customerName.includes('+');

      if (isGenericName) {
        instructions.push(
          "- The customer's name appears to be a placeholder or phone number. Politely ask for their actual name and email early in the conversation to better assist them.",
        );
      }
    }
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
  action: 'REPLY' | 'ESCALATE' | 'IGNORE' | 'AUTO_RESOLVE'; // Added AUTO_RESOLVE
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
  smartCacheService?: SmartCacheService,
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
        undefined,
        10, // Fetch 10 max (we'll slice to 5 below)
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

  // Take last 5 messages for context window (reduced from 10 for cost savings)
  const recentMessages = allMessages.slice(-5);

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
    {
      name: 'ask_customer_for_clarification',
      description:
        'Ask the customer for more information or clarification when you are stuck or missing details needed to help them.',
      schema: z.object({
        question: z
          .string()
          .describe(
            'The specific question or request for info to send to the customer.',
          ),
      }),
      func: async ({ question }: { question: string }) => {
        console.log(`[Tool] Asking for clarification`);
        return { __action: 'REPLY', message: question };
      },
    },
  ];

  // 3. Initialize Model and Messages
  // Flash for cheap intent/routing/greetings; Pro for full ReAct reasoning
  const proModelName = 'gemini-3-pro-preview';
  const flashModelName = 'gemini-3-flash-preview'; // FIX: was incorrectly set to Pro

  const fastModel = AIModelFactory.create(configService, {
    provider: 'vertex',
    model: flashModelName,
  });

  const mainModel = AIModelFactory.create(configService, {
    provider: 'vertex',
    model: proModelName,
  });

  // Dynamic Model Selection based on Complexity
  // We default to Pro, but if we detected 'SIMPLE' complexity in a previous step, we might want to use Flash.
  // However, since we define 'modelWithTools' BEFORE the intent check loop in original code, we need to defer binding.
  // OR we can move the model definition down.
  // Let's defer binding to the ReAct loop or bind both.
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

  const systemPrompt = buildSystemPrompt(
    org,
    channel,
    (ticket.customerId as any).firstName,
  );

  // 4. SMART CACHE CHECK (Literal & Semantic Cache) - SUPER FAST PATH
  let requestComplexity = 'COMPLEX';
  let intent = 'OTHER';
  let intentUsage: any = {};
  const lastUserMessage = recentMessages[recentMessages.length - 1];

  if (
    smartCacheService &&
    lastUserMessage &&
    lastUserMessage.authorType === 'customer'
  ) {
    const cacheResult = await smartCacheService.findMatch(
      lastUserMessage.content,
      organizationId,
    );

    if (
      cacheResult.type !== 'NONE' &&
      cacheResult.response &&
      (cacheResult.type === 'LITERAL' || (cacheResult.score || 1) >= 0.94)
    ) {
      const customerName = (ticket.customerId as any).firstName || 'Customer';
      const personalizedContent = await smartCacheService.personalize(
        cacheResult.response,
        { name: customerName },
        lastUserMessage.content,
      );

      return {
        action: 'REPLY',
        content: personalizedContent,
        confidence: 100,
        metadata: {
          tokenUsage: {},
          knowledgeBaseUsed: true,
          performanceMs: Date.now() - totalStart,
          toolCalls: [`smart_cache_${cacheResult.type.toLowerCase()}`],
        },
      };
    }
  }

  // 5. Intent Classification Check (Stop Infinite Loops)
  if (lastUserMessage && lastUserMessage.authorType === 'customer') {
    const latestText = lastUserMessage.content.trim().toLowerCase();

    // Fast-path: Regex check for obvious gratitude/closure phrases
    // This avoids sending a costly LLM call for simple "Thank you" messages
    const gratitudeRegex =
      /^(thanks?(\s+you)?|thank\s+you(\s+(so|very)\s+much)?|thx|ty|cheers|appreciated?|great\s+thanks?|ok\s+thanks?|perfect\s+thanks?|wonderful\s+thanks?)[\s!.]*$/i;
    const closureRegex =
      /^(bye|goodbye|good\s*bye|see\s+you|take\s+care|have\s+a\s+(good|nice|great)\s+(day|one|evening)|that'?s?\s+(all|it)|nothing\s+(else|more)|no\s+thanks?|i'?m?\s+good)[\s!.]*$/i;

    if (gratitudeRegex.test(latestText)) {
      console.log(
        `[ReAct Agent] Fast-path GRATITUDE detected for "${lastUserMessage.content}"`,
      );
      return {
        action: 'AUTO_RESOLVE',
        content: '',
        confidence: 100,
        metadata: {
          tokenUsage: {},
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['intent_check_fast'],
        },
      };
    }

    if (closureRegex.test(latestText)) {
      console.log(
        `[ReAct Agent] Fast-path CLOSURE detected for "${lastUserMessage.content}"`,
      );
      return {
        action: 'AUTO_RESOLVE',
        content: '',
        confidence: 100,
        metadata: {
          tokenUsage: {},
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['intent_check_fast'],
        },
      };
    }

    // LLM-based intent classification (for non-obvious cases)
    // Focus on the LATEST message to determine intent, with prior messages as context only
    const priorCustomerMessages = recentMessages
      .filter((m) => m.authorType === 'customer')
      .slice(-3, -1) // exclude the latest
      .map((m) => m.content)
      .join('\n');

    const intentPrompt = `
      Analyze the customer's LATEST message and determine their current intent.
      
      ${priorCustomerMessages ? `Prior messages (for context only):\n"${priorCustomerMessages}"\n` : ''}
      LATEST message (this is what you must classify):
      "${lastUserMessage.content}"
      
      Categorize the user's CURRENT intent based on their LATEST message:
      - GRATITUDE: Saying thanks, appreciating help, or acknowledging a good answer.
      - CLOSURE: Ending the conversation (e.g. "Bye", "That's all").
      - AFFIRMATIVE: Simple yes/ok.
      - INQUIRY: Asking NEW questions or reporting NEW issues.
      - OTHER: Mixed or unclear.
      
      IMPORTANT: Focus ONLY on what the LATEST message conveys. If the customer previously asked questions but is now saying "thank you", that is GRATITUDE, not INQUIRY.
      `;

    try {
      const routingSchema = z.object({
        intent: z
          .enum([
            'GRATITUDE',
            'CLOSURE',
            'AFFIRMATIVE',
            'INQUIRY',
            'GREETING',
            'OTHER',
          ])
          .describe('The intent of the customer LATEST message'),
        complexity: z
          .enum(['SIMPLE', 'COMPLEX'])
          .describe(
            'SIMPLE if the user is just saying hi, thanks, or simple phatic communication. COMPLEX if the user is asking a question, reporting an issue, or needs information.',
          ),
      });

      const modelWithStructuredIntent = (fastModel as any).withStructuredOutput
        ? (fastModel as any).withStructuredOutput(routingSchema)
        : null;

      if (modelWithStructuredIntent) {
        const routingResult = await modelWithStructuredIntent.invoke([
          new SystemMessage(
            'You are a routing agent. Categorize the user LATEST message intent and determine complexity. Focus on what the LATEST message says, not the overall conversation history.',
          ),
          new HumanMessage(intentPrompt),
        ]);
        intent = routingResult.intent;
        requestComplexity = routingResult.complexity;
      } else {
        const intentResp = await fastModel.invoke([
          new HumanMessage(
            `${intentPrompt}\n\nAlso classify complexity as SIMPLE or COMPLEX.\nRespond in format: INTENT|COMPLEXITY`,
          ),
        ]);
        intentUsage = intentResp.usage_metadata;
        const rawResponse =
          typeof intentResp.content === 'string'
            ? intentResp.content.trim().toUpperCase()
            : '';
        const parts = rawResponse.split('|');
        const rawIntent = parts[0] ? parts[0].trim() : 'OTHER';
        const rawComplexity = parts[1] ? parts[1].trim() : 'COMPLEX';

        intent =
          [
            'GRATITUDE',
            'CLOSURE',
            'AFFIRMATIVE',
            'INQUIRY',
            'GREETING',
            'OTHER',
          ].find((i) => rawIntent.includes(i)) || 'OTHER';

        requestComplexity = rawComplexity.includes('SIMPLE')
          ? 'SIMPLE'
          : 'COMPLEX';
      }
    } catch (e) {
      console.error(`[ReAct Agent] Intent detection failed:`, e);
    }

    console.log(
      `[ReAct Agent] Intent Check (Flash): ${intent} for "${lastUserMessage.content}"`,
    );

    if (['GRATITUDE', 'CLOSURE'].includes(intent)) {
      return {
        action: 'AUTO_RESOLVE',
        content: '',
        confidence: 100,
        metadata: {
          tokenUsage: intentUsage,
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['intent_check'],
        },
      };
    }

    // Direct Reply for Greetings (Flash)
    if (intent === 'GREETING') {
      const greetingResp = await fastModel.invoke([
        new SystemMessage(
          'You are a helpful customer support agent. Reply to the user greeting politely and offer help. Keep it short.',
        ),
        new HumanMessage(lastUserMessage.content),
      ]);
      return {
        action: 'REPLY',
        content:
          typeof greetingResp.content === 'string'
            ? greetingResp.content
            : 'Hello! How can I help you today?',
        confidence: 100,
        metadata: {
          tokenUsage: greetingResp.usage_metadata,
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['greeting_reply'],
        },
      };
    }
  }

  // Build Multimodal History
  const historyMessages: BaseMessage[] = [];

  // Helper to fetch media (image, audio, video) as base64
  const fetchMediaAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (e) {
      return null;
    }
  };

  // Process history: Only include large media for the very recent messages
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    const isVeryRecent = i >= recentMessages.length - 3; // Keep media only for last 3 messages
    const role = msg.authorType === 'customer' ? 'user' : 'assistant';
    const contentParts: any[] = [];

    // Cap each message at 800 chars to prevent large email bodies from blowing up the context
    const textContent = (msg.content || '').slice(0, 800);
    if (textContent) {
      contentParts.push({ type: 'text', text: textContent });
    }

    // Add attachments (Only for very recent messages to save tokens)
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        const isImage = att.mimeType && att.mimeType.startsWith('image/');
        const isAudio = att.mimeType && att.mimeType.startsWith('audio/');
        const isVideo = att.mimeType && att.mimeType.startsWith('video/');

        if ((isImage || isAudio || isVideo) && att.path?.startsWith('http')) {
          if (isVeryRecent) {
            const base64Data = await fetchMediaAsBase64(att.path);
            if (base64Data) {
              if (isImage) {
                contentParts.push({
                  type: 'image_url',
                  image_url: { url: base64Data },
                });
              } else {
                contentParts.push({
                  type: 'media',
                  mimeType: att.mimeType,
                  data: base64Data.split(',')[1],
                });
              }
            }
          } else {
            // Use the stored AI description if available, otherwise fallback to placeholder
            const summary = att.aiDescription
              ? `[MEDIA SUMMARY: ${att.aiDescription}]`
              : `[${att.mimeType.split('/')[0].toUpperCase()} ATTACHMENT: ${att.name || 'File'}]`;

            contentParts.push({
              type: 'text',
              text: summary,
            });
          }
        }
      }
    }

    if (contentParts.length === 0) {
      contentParts.push({ type: 'text', text: '[Empty Message]' });
    }

    if (role === 'user') {
      historyMessages.push(new HumanMessage({ content: contentParts }));
    } else {
      historyMessages.push(new AIMessage({ content: contentParts }));
    }
  }

  // Cap description length to avoid huge email bodies ballooning the context
  const issueContext = (
    ticket.summary ||
    ticket.description ||
    'No summary available.'
  ).slice(0, 500);

  const contextInstruction = `
Context:
- Ticket ID: ${ticket.displayId || ticket._id}
- Subject: ${ticket.subject}
- Status: ${ticket.status}
- Current Priority: ${ticket.priority}
- Summary of Issue: ${issueContext}

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
  const MAX_TURNS = 10;
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

      // Select Model based on Complexity Check from earlier
      // We use the local complexity flag or default to COMPLEX (Pro)
      const isSimple = requestComplexity === 'SIMPLE';
      const selectedModelProxy = isSimple
        ? fastModelWithTools
        : mainModelWithTools;

      console.log(
        `[ReAct Loop] Using ${isSimple ? 'Flash (Simple)' : 'Pro (Complex)'} model for turn ${turn}`,
      );

      // Invoke Model
      const aiResponse = await selectedModelProxy.invoke(messages);
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
              // Store high-confidence response in cache if it's a long message
              if (
                raw.message &&
                raw.message.length > 50 &&
                smartCacheService &&
                lastUserMessage
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
      action: 'ESCALATE', // Escalate on internal error instead of ignoring
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
