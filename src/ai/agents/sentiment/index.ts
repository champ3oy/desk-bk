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
  const totalStart = Date.now();
  console.log(`[PERF] analyzeSentiment started for ticket ${ticket_id}`);

  // ========== PARALLELIZED DATA FETCHING ==========
  const parallelStart = Date.now();

  const [ticket, threads, comments] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    threadsService.findAll(ticket_id, organizationId, userId, userRole),
    commentsService.findAll(ticket_id, userId, userRole),
  ]);

  console.log(
    `[PERF] Parallel fetch (ticket + threads + comments): ${Date.now() - parallelStart}ms`,
  );

  // Fetch messages for all threads in parallel
  const messagesStart = Date.now();
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
  console.log(
    `[PERF] Fetch messages for ${threads.length} threads: ${Date.now() - messagesStart}ms`,
  );

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService);
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // ========== BUILD CONTEXT WITH PRE-FETCHED DATA ==========
  const ticketData = {
    ticket: ticket.toObject(),
    threads: threadsWithMessages,
    comments: JSON.parse(JSON.stringify(comments)),
  };

  const contextPrompt = `# TICKET DATA FOR SENTIMENT ANALYSIS

## Ticket Details
- ID: ${ticketData.ticket._id}
- Subject: ${ticketData.ticket.subject}
- Description: ${ticketData.ticket.description}
- Status: ${ticketData.ticket.status}
- Priority: ${ticketData.ticket.priority}
- Created: ${ticketData.ticket.createdAt}

## Conversation History (Focus on customer messages for sentiment)
${threadsWithMessages
  .map(
    (thread, idx) => `
### Thread ${idx + 1}
${thread.messages
  .map(
    (
      msg: any,
    ) => `[${msg.authorType === 'customer' ? 'Customer' : 'Agent'}] (${new Date(msg.createdAt).toLocaleString()})
${msg.content}`,
  )
  .join('\n\n')}
`,
  )
  .join('\n')}

## Comments
${ticketData.comments.map((comment: any) => `[${comment.isInternal ? 'Internal' : 'Public'}] ${comment.content}`).join('\n')}

# TASK
Analyze the sentiment of the customer communications in this ticket. Consider all customer messages, the ticket subject and description, and any relevant comments. Return the sentiment analysis in a structured format with:
1. Primary sentiment
2. Confidence level
3. Brief explanation
4. Key phrases or indicators`;

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();
  const response = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextPrompt },
  ]);
  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract content
  const content = response.content;
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
  const sentimentMatch = responseContent.match(
    /(?:Primary|Primarily)\s+sentiment[:\s]+(\w+)/i,
  );
  const confidenceMatch = responseContent.match(
    /Confidence\s+level[:\s]+(\w+)/i,
  );
  const explanationMatch = responseContent.match(
    /(?:Brief\s+)?explanation\s+(?:of\s+why\s+this\s+sentiment\s+was\s+detected|:)\s*:?\s*([\s\S]*?)(?=\nKey\s+phrases|$)/i,
  );
  const keyPhrasesMatch = responseContent.match(
    /Key\s+phrases\s+(?:or\s+indicators\s+)?(?:that\s+led\s+to\s+this\s+conclusion|:)\s*:?\s*([\s\S]*?)$/i,
  );

  const sentiment = sentimentMatch?.[1]?.toLowerCase() || 'neutral';
  const confidence = confidenceMatch?.[1]?.toLowerCase() || 'medium';
  const explanation = explanationMatch?.[1]?.trim() || '';
  const keyPhrasesText = keyPhrasesMatch?.[1]?.trim() || '';

  const keyPhrases = keyPhrasesText
    .split(/\n/)
    .map((line) => {
      return line
        .trim()
        .replace(/^[-•*]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim();
    })
    .filter((phrase) => phrase.length > 0);

  console.log(`[PERF] TOTAL analyzeSentiment: ${Date.now() - totalStart}ms`);

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
    performanceMs: Date.now() - totalStart,
  };
};
