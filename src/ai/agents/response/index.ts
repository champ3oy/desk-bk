import * as z from 'zod';
import { createAgent, tool } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';

const DEFAULT_SYSTEM_PROMPT = `You are an expert customer support agent. Your role is to draft professional, empathetic, and helpful responses to customers. 
When drafting a response:
- Be clear, concise, and professional
- Show empathy and understanding
- Address the customer's concerns directly
- Provide actionable solutions when possible
- Match the tone to the customer's sentiment
- Use appropriate language for the communication channel
- Ensure the response is appropriate for the ticket context and conversation history
- Consider all threads and messages in the ticket to understand the full context`;

/**
 * Build a dynamic system prompt based on organization AI configuration
 */
export function buildSystemPrompt(org: Organization): string {
  // Use custom prompt if provided, otherwise use default
  let basePrompt = org.aiPersonalityPrompt || DEFAULT_SYSTEM_PROMPT;

  const toneInstructions: string[] = [];

  // Formality (0-100)
  if (org.aiFormality !== undefined) {
    if (org.aiFormality < 30) {
      toneInstructions.push('- Use casual, conversational language');
      toneInstructions.push('- Feel free to use contractions naturally');
    } else if (org.aiFormality > 70) {
      toneInstructions.push(
        '- Maintain formal, professional tone at all times',
      );
      toneInstructions.push(
        '- Avoid contractions (use "do not" instead of "don\'t")',
      );
      toneInstructions.push('- Use complete sentences and proper grammar');
    }
  }

  // Empathy (0-100)
  if (org.aiEmpathy !== undefined && org.aiEmpathy > 70) {
    toneInstructions.push('- Show high empathy and emotional understanding');
    toneInstructions.push(
      '- Acknowledge customer feelings before problem-solving',
    );
    toneInstructions.push(
      '- Use empathetic language like "I understand how frustrating this must be"',
    );
  }

  // Response length (0-100)
  if (org.aiResponseLength !== undefined) {
    if (org.aiResponseLength < 30) {
      toneInstructions.push('- Keep responses brief and concise');
      toneInstructions.push('- Get straight to the point');
    } else if (org.aiResponseLength > 70) {
      toneInstructions.push('- Provide detailed, comprehensive responses');
      toneInstructions.push('- Include thorough explanations and context');
    }
  }

  // Emojis
  if (org.aiUseEmojis) {
    toneInstructions.push(
      '- Use appropriate emojis to convey warmth and friendliness (✨, 😊, 👍, 🎉)',
    );
  } else {
    toneInstructions.push('- Do not use emojis in responses');
  }

  // Greetings
  if (org.aiIncludeGreetings === false) {
    toneInstructions.push(
      '- Skip greetings, get straight to addressing the issue',
    );
  } else {
    toneInstructions.push('- Start with friendly greetings');
  }

  // Sign-off
  if (org.aiIncludeSignOff === false) {
    toneInstructions.push('- Skip sign-offs, end with the solution');
  }

  // Vocabulary preferences
  if (org.aiWordsToUse) {
    toneInstructions.push(`- Prefer using these phrases: ${org.aiWordsToUse}`);
  }
  if (org.aiWordsToAvoid) {
    toneInstructions.push(`- Avoid using these phrases: ${org.aiWordsToAvoid}`);
  }

  // Combine everything
  if (toneInstructions.length > 0) {
    return `${basePrompt}\n\n# TONE GUIDELINES\n${toneInstructions.join('\n')}`;
  }

  return basePrompt;
}

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

export const createResponseAgent = async (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: any, // KnowledgeBaseService - using any to avoid circular dependency
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

  // Fetch organization AI settings
  const org = await organizationsService.findOne(organizationId);

  // Build dynamic system prompt based on organization configuration
  let systemPrompt = buildSystemPrompt(org);

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
  organizationsService: OrganizationsService,
  knowledgeBaseService: any, // KnowledgeBaseService
  userId: string,
  userRole: UserRole,
  organizationId: string,
  additionalContext?: string,
) => {
  // Fetch ticket data to get context for knowledge base retrieval
  const ticket = await ticketsService.findOne(
    ticket_id,
    userId,
    userRole,
    organizationId,
  );

  // Retrieve relevant knowledge base content
  let knowledgeContext = '';
  if (knowledgeBaseService) {
    try {
      const query = `${ticket.subject} ${ticket.description}`;
      knowledgeContext = await knowledgeBaseService.retrieveRelevantContent(
        query,
        organizationId,
        3, // Max 3 relevant documents
      );
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
    }
  }

  const agent = await createResponseAgent(
    ticketsService,
    threadsService,
    configService,
    organizationsService,
    knowledgeBaseService,
    userId,
    userRole,
    organizationId,
  );

  // Build context prompt with knowledge base content
  let contextPrompt = additionalContext
    ? `Draft a response for ticket ${ticket_id}. Consider all threads and messages in this ticket. Additional context: ${additionalContext}`
    : `Draft a professional response for ticket ${ticket_id}. Consider all threads, messages, ticket details, conversation history, and customer sentiment.`;

  // Add knowledge base context if available
  if (knowledgeContext) {
    contextPrompt += `\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information from our knowledge base to inform your response:\n\n${knowledgeContext}`;
  }

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
      knowledgeBaseUsed: !!knowledgeContext,
    },
  };
};
