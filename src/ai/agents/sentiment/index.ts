import * as z from 'zod';
import { createAgent, tool } from 'langchain';
import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';

const systemPrompt = `You are an expert sentiment analyzer for customer support tickets. Your role is to analyze the emotional tone and sentiment of customer communications.

Analyze the sentiment based on:
- Ticket subject and description
- All messages in threads (especially customer messages)
- Comments and interactions
- Language patterns, tone, and word choice

Return one of the following sentiment categories:
- angry: Customer is upset, frustrated, or expressing strong negative emotions
- sad: Customer is disappointed, discouraged, or expressing sadness
- happy: Customer is satisfied, pleased, or expressing positive emotions
- frustrated: Customer is experiencing difficulties but not necessarily angry
- neutral: Customer communication is factual and without strong emotional tone
- concerned: Customer is worried or anxious about an issue
- grateful: Customer is expressing appreciation or thanks
- confused: Customer is unclear or needs clarification

Provide your analysis in a structured format with:
1. Primary sentiment (one of the categories above)
2. Confidence level (high, medium, low)
3. Brief explanation of why this sentiment was detected
4. Key phrases or indicators that led to this conclusion`;

const createGetTicketDataTool = (
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

        // Fetch messages for each thread (focus on customer messages for sentiment)
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

        // Return comprehensive ticket information for sentiment analysis
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
      name: 'get_ticket_data',
      description:
        'Get all ticket information including threads, messages, and comments for sentiment analysis',
      schema: z.object({
        ticket_id: z.string(),
      }),
    },
  );
};

export const createSentimentAgent = (
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const getTicketData = createGetTicketDataTool(
    ticketsService,
    threadsService,
    commentsService,
    userId,
    userRole,
    organizationId,
  );

  const model = AIModelFactory.create(configService);

  return createAgent({
    model,
    tools: [getTicketData],
    systemPrompt,
  });
};

export const analyzeSentiment = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const agent = createSentimentAgent(
    ticketsService,
    threadsService,
    commentsService,
    configService,
    userId,
    userRole,
    organizationId,
  );

  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: `Analyze the sentiment for ticket ${ticket_id}. Consider all customer communications, messages, and interactions. Return the sentiment analysis in a structured format.`,
      },
    ],
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

  // Parse the structured sentiment response
  // Handle multiple formats:
  // - "Primary sentiment:" or "Primarily sentiment:" (with or without markdown)
  // - "Confidence level:" (with or without markdown)
  // - "Explanation:" or "Brief explanation of why this sentiment was detected:"
  // - "Key phrases or indicators:" or "Key phrases or indicators that led to this conclusion:"

  // Match sentiment (Primary/Primarily sentiment: <value>)
  const sentimentMatch = responseContent.match(
    /(?:Primary|Primarily)\s+sentiment[:\s]+(\w+)/i,
  );

  // Match confidence (Confidence level: <value>)
  const confidenceMatch = responseContent.match(
    /Confidence\s+level[:\s]+(\w+)/i,
  );

  // Extract explanation - matches "Brief explanation of why this sentiment was detected: <text>"
  // or "Explanation: <text>" - captures everything until "Key phrases" or end of string
  const explanationMatch = responseContent.match(
    /(?:Brief\s+)?explanation\s+(?:of\s+why\s+this\s+sentiment\s+was\s+detected|:)\s*:?\s*([\s\S]*?)(?=\nKey\s+phrases|$)/i,
  );

  // Extract key phrases - matches "Key phrases or indicators that led to this conclusion:"
  // or "Key phrases or indicators:" followed by bullet points or text
  const keyPhrasesMatch = responseContent.match(
    /Key\s+phrases\s+(?:or\s+indicators\s+)?(?:that\s+led\s+to\s+this\s+conclusion|:)\s*:?\s*([\s\S]*?)$/i,
  );

  const sentiment = sentimentMatch?.[1]?.toLowerCase() || 'neutral';
  const confidence = confidenceMatch?.[1]?.toLowerCase() || 'medium';
  const explanation = explanationMatch?.[1]?.trim() || '';
  const keyPhrasesText = keyPhrasesMatch?.[1]?.trim() || '';

  // Extract key phrases (could be comma-separated, quoted, or bullet points)
  // Handle bullet points like "- \"Unable to login\"" or "- \"keep getting an error message\""
  const keyPhrases = keyPhrasesText
    .split(/\n/)
    .map((line) => {
      // Remove bullet points and quotes
      return line
        .trim()
        .replace(/^[-•*]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim();
    })
    .filter((phrase) => phrase.length > 0);

  return {
    sentiment,
    confidence,
    explanation,
    keyPhrases:
      keyPhrases.length > 0
        ? keyPhrases
        : keyPhrasesText
          ? [keyPhrasesText]
          : [],
    content: responseContent,
  };
};
