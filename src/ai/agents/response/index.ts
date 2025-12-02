import * as z from 'zod';
import { createAgent, tool } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';

const systemPrompt = `You are an expert customer support agent. Your role is to draft professional, empathetic, and helpful responses to customers. 
When drafting a response:
- Be clear, concise, and professional
- Show empathy and understanding
- Address the customer's concerns directly
- Provide actionable solutions when possible
- Match the tone to the customer's sentiment
- Use appropriate language for the communication channel
- Ensure the response is appropriate for the ticket context and conversation history
- Consider all threads and messages in the ticket to understand the full context`;

const createGetTicketDataTool = (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  return tool(
    async ({ ticket_id }) => {
      try {
        // Fetch ticket with all populated fields
        const ticket = await ticketsService.findOne(
          ticket_id,
          userId,
          userRole,
          organizationId,
        );

        // Fetch all threads for the ticket
        const threads = await threadsService.findAll(
          ticket_id,
          organizationId,
          userId,
          userRole,
        );

        // Fetch messages for each thread
        const threadsWithMessages = await Promise.all(
          threads.map(async (thread) => {
            const messages = await threadsService.getMessages(
              thread._id.toString(),
              organizationId,
              userId,
              userRole,
            );
            return {
              ...thread.toObject(),
              messages: messages.map((msg) => msg.toObject()),
            };
          }),
        );

        // Return ticket with all threads and messages
        return {
          ticket: ticket.toObject(),
          threads: threadsWithMessages,
        };
      } catch (error) {
        return {
          error: error.message || 'Failed to fetch ticket information',
        };
      }
    },
    {
      name: 'get_ticket_data',
      description:
        'Get ticket information with all threads and messages for drafting a response',
      schema: z.object({
        ticket_id: z.string(),
      }),
    },
  );
};

export const createResponseAgent = (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const getTicketData = createGetTicketDataTool(
    ticketsService,
    threadsService,
    userId,
    userRole,
    organizationId,
  );

  // Get API key and model from config
  const apiKey = configService.get<string>('ai.geminiApiKey');
  const modelName =
    configService.get<string>('ai.model') || 'gemini-2.0-flash-exp';

  if (!apiKey) {
    throw new Error(
      'Gemini API key is not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.',
    );
  }

  // Create Google Generative AI model instance
  const model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
  });

  return createAgent({
    model,
    tools: [getTicketData],
    systemPrompt,
  });
};

export const draftResponse = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
  additionalContext?: string,
) => {
  const agent = createResponseAgent(
    ticketsService,
    threadsService,
    configService,
    userId,
    userRole,
    organizationId,
  );

  const contextPrompt = additionalContext
    ? `Draft a response for ticket ${ticket_id}. Consider all threads and messages in this ticket. Additional context: ${additionalContext}`
    : `Draft a professional response for ticket ${ticket_id}. Consider all threads, messages, ticket details, conversation history, and customer sentiment.`;

  const result = await agent.invoke({
    messages: [{ role: 'user', content: contextPrompt }],
  });

  // Extract the final AI message content
  const messages = result.messages || [];
  const lastMessage = messages[messages.length - 1];
  const content = lastMessage?.content || '';

  // Handle both string and array content formats
  const responseContent =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  return {
    content: responseContent,
    metadata: {
      tokenUsage:
        (lastMessage as any)?.usage_metadata ||
        (lastMessage as any)?.response_metadata?.tokenUsage,
    },
  };
};
