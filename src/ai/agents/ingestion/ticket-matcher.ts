import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export const analyzeIfFollowUp = async (
  newMessageContent: string,
  lastTicketSubject: string,
  lastTicketDescription: string,
  configService: ConfigService,
): Promise<boolean> => {
  const model = AIModelFactory.create(configService);

  const systemPrompt = `You are a support context analyzer. 
A customer has just sent a new message. We have a recently closed ticket from the same customer.
Your job is to determine if the new message is a follow-up/continuation of the previous ticket or a totally new issue.

Rules:
- If it's a "thank you", "confirmed", or a direct follow-up question to the previous topic, respond with "FOLLOW_UP".
- If it's an acknowledgment of the closure (e.g., "okay thanks"), respond with "FOLLOW_UP".
- If it's a completely different topic or service request, respond with "NEW_ISSUE".
- Respond with ONLY one word: "FOLLOW_UP" or "NEW_ISSUE".`;

  const context = `
RECENTLY CLOSED TICKET:
Subject: ${lastTicketSubject}
Description: ${lastTicketDescription}

NEW MESSAGE:
"${newMessageContent}"
`;

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

  return rawContent.trim().toUpperCase() === 'FOLLOW_UP';
};
