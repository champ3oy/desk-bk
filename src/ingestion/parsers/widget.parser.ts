import { Injectable } from '@nestjs/common';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { MessageChannel } from '../../threads/entities/message.entity';

@Injectable()
export class WidgetParser {
  parse(payload: Record<string, any>): IncomingMessageDto {
    // Payload expected:
    // {
    //   content: string;
    //   sessionId: string; (customer ID equivalent)
    //   name?: string;
    //   email?: string;
    // }

    const senderId = payload.sessionId || 'anonymous';

    // Generate a pseudo-email for widget visitors if not provided
    // This avoids DB unique constraint issues with null emails
    const senderEmail =
      payload.email || `widget-${senderId}@visitor.morpheusdesk.local`;

    return {
      channel: MessageChannel.WIDGET,
      messageId: `widget_${senderId}_${Date.now()}`, // Generate a unique ID
      senderEmail: senderEmail,
      senderPhone: undefined,
      senderName: payload.name || 'Website Visitor',
      content: payload.content || '',
      threadId: payload.sessionId, // Use session ID as thread ID for strict matching
      attachments: [],
      metadata: payload,
    };
  }
}
