import * as z from 'zod';
import { createAgent, tool } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';

const systemPrompt = `You are an expert ticket summarizer. You are given a ticket and you need to summarize it in a way that is easy to understand and use for a customer support agent.`;

const createGetTicketTool = (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
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

        // Fetch comments for the ticket
        const comments = await commentsService.findAll(
          ticket_id,
          userId,
          userRole,
        );

        // Return comprehensive ticket information
        // Serialize to plain objects for JSON compatibility
        return {
          ticket: ticket.toObject(),
          threads: threadsWithMessages,
          comments: JSON.parse(JSON.stringify(comments)),
        };
      } catch (error) {
        return {
          error: error.message || 'Failed to fetch ticket information',
        };
      }
    },
    {
      name: 'get_ticket',
      description:
        'Get information and history of a ticket including threads, messages, and comments',
      schema: z.object({
        ticket_id: z.string(),
      }),
    },
  );
};

export const createSummarizeAgent = (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const getTicket = createGetTicketTool(
    ticketsService,
    threadsService,
    commentsService,
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
    tools: [getTicket],
    systemPrompt,
  });
};

export const summarizeTicket = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const agent = createSummarizeAgent(
    ticketsService,
    threadsService,
    commentsService,
    configService,
    userId,
    userRole,
    organizationId,
  );

  const result = await agent.invoke({
    messages: [{ role: 'user', content: `summarize this ticket ${ticket_id}` }],
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
    summary: responseContent,
    content: responseContent,
    metadata: {
      tokenUsage:
        (lastMessage as any)?.usage_metadata ||
        (lastMessage as any)?.response_metadata?.tokenUsage,
    },
  };
};
