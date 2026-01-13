import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';

const systemPrompt = `You are an expert ticket summarizer. You are given a ticket and you need to summarize it in a way that is easy to understand and use for a customer support agent.

Your summary should include:
1. A brief overview of the issue
2. Key points from the conversation
3. Current status and any pending actions
4. Customer's main concerns`;

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

  const contextPrompt = `# TICKET DATA FOR SUMMARIZATION

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
    ) => `[${msg.messageType === 'external' ? 'Customer' : 'Agent'}] (${new Date(msg.createdAt).toLocaleString()})
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
Summarize this ticket in a way that is easy to understand and use for a customer support agent. Include:
1. A brief overview of the issue
2. Key points from the conversation
3. Current status and any pending actions
4. Customer's main concerns`;

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

  console.log(`[PERF] TOTAL summarizeTicket: ${Date.now() - totalStart}ms`);

  return {
    summary: responseContent,
    content: responseContent,
    metadata: {
      tokenUsage:
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      performanceMs: Date.now() - totalStart,
    },
  };
};
