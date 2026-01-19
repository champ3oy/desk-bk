import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';

export const briefSummary = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const ticket = await ticketsService.findOne(
    ticket_id,
    userId,
    userRole,
    organizationId,
  );
  const thread = await threadsService.findByTicket(
    ticket_id,
    organizationId,
    userId,
    userRole,
  );

  let recentMessages: string[] = [];
  if (thread) {
    const messages = await threadsService.getMessages(
      thread._id.toString(),
      organizationId,
      userId,
      userRole,
    );
    recentMessages = messages
      .slice(-5)
      .map((m) => `[${m.authorType}] ${m.content}`);
  }

  const model = AIModelFactory.create(configService);

  const systemPrompt = `You are a helpful support assistant. Provide a very short, one-sentence summary of the following ticket. High density of information. Do NOT use more than 15 words. Respond ONLY with the sentence.`;

  const context = `Subject: ${ticket.subject}\nDescription: ${ticket.description}\nRecent History:\n${recentMessages.join('\n')}`;

  const response = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context },
  ]);

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

  return {
    summary: rawContent.trim(),
  };
};
