import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export const generateAutoCloseMessage = async (
  displayId: string,
  subject: string,
  configService: ConfigService,
) => {
  const model = AIModelFactory.create(configService);

  const systemPrompt = `You are a professional and empathetic customer support assistant.
Your task is to write a short, polite message to a customer notifying them that their ticket is being closed due to inactivity.

Guidelines:
- Mention the ticket reference: #${displayId}.
- Mention the topic: "${subject}".
- Explain that because we haven't heard back, we're closing the ticket for now.
- Invite them to reply if they still need help, which will reopen the conversation.
- Keep it concise (2-3 sentences max).
- Use a friendly but professional tone.`;

  const context = `Ticket ID: #${displayId}\nSubject: ${subject}`;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(context),
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

  return rawContent.trim();
};
