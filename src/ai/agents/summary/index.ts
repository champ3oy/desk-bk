import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';

const systemPrompt = `You are an expert ticket summarizer and analyst. You must analyze the provided ticket data and return a JSON object containing a comprehensive summary, sentiment analysis, urgency level, main topic, and recommended actions.

Do not mention ticket ID

JSON Structure:
{
  "summary": "the summary should be properly formatted markdown and put it in this sections:
1. A brief overview of the issue
2. Key points from the conversation
3. Current status and any pending actions
4. Customer's main concerns.",
  "sentiment": "One of: Frustrated, Neutral, Happy, Angry, Concerned",
  "urgency": "One of: Low, Medium, High, Urgent",
  "topic": "Brief topic label (e.g., Billing, Bug, Feature Request, Question)"
}`;

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
  const totalStart = Date.now();
  console.log(`[PERF] summarizeTicket started for ticket ${ticket_id}`);

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

  const contextPrompt = `# TICKET DATA FOR ANALYZATION
  
## Ticket Details
- ID: ${ticketData.ticket._id}
- Subject: ${ticketData.ticket.subject}
- Description: ${ticketData.ticket.description}
- Status: ${ticketData.ticket.status}
- Priority: ${ticketData.ticket.priority}
- Created: ${ticketData.ticket.createdAt}

## Conversation History
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

## Internal Comments
${
  ticketData.comments.length > 0
    ? ticketData.comments
        .map(
          (comment: any) =>
            `[${comment.isInternal ? 'Internal' : 'Public'}] ${comment.content}`,
        )
        .join('\n')
    : 'No comments'
}

# TASK
Respond ONLY with a JSON object. Analyze the ticket and provide:
1. summary: A rich markdown summary of the issue and conversation.
2. sentiment: The primary emotional tone of the customer.
3. urgency: The priority from a customer satisfaction and business impact perspective.
4. topic: A short, representative tag for the issue.`;

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();

  let response;
  try {
    response = await model.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextPrompt },
    ]);
  } catch (error: any) {
    console.error(`[ERROR] summarizeTicket LLM invocation failed:`, error);
    // ... rest of error handling same ...
    const errorMessage = error?.message || String(error);
    if (
      errorMessage.includes('429') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('RESOURCE_EXHAUSTED')
    ) {
      return {
        summary: null,
        content: null,
        error:
          'AI service is currently rate limited. Please try again in a few moments.',
        metadata: {
          performanceMs: Date.now() - totalStart,
          errorType: 'rate_limit',
        },
      };
    }

    return {
      summary: null,
      content: null,
      error:
        'Failed to generate summary. The AI service may be temporarily unavailable.',
      metadata: {
        performanceMs: Date.now() - totalStart,
        errorType: 'ai_error',
      },
    };
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract and Parse JSON
  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  let parsedData: any = {};
  try {
    // Attempt to extract JSON if LLM returned markdown blocks
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : rawContent;
    parsedData = JSON.parse(jsonString);
  } catch (e) {
    console.warn(
      '[WARN] Failed to parse JSON from AI response, falling back',
      e,
    );
    parsedData = {
      summary: rawContent,
      sentiment: 'Neutral',
      urgency: 'Medium',
      topic: 'General',
    };
  }

  console.log(`[PERF] TOTAL summarizeTicket: ${Date.now() - totalStart}ms`);

  return {
    summary: parsedData.summary || rawContent,
    content: rawContent,
    sentiment: parsedData.sentiment || 'Neutral',
    urgency: parsedData.urgency || 'Medium',
    topic: parsedData.topic || 'General',
    error: null,
    metadata: {
      tokenUsage:
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      performanceMs: Date.now() - totalStart,
    },
  };
};
