import { Injectable } from '@nestjs/common';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { MessageChannel } from '../../threads/entities/message.entity';

@Injectable()
export class SmsParser {
  /**
   * Parse SMS webhook payload into normalized IncomingMessageDto
   * Supports common SMS providers (Twilio, etc.)
   */
  parse(payload: Record<string, any>, provider: string): IncomingMessageDto {
    let parsed: IncomingMessageDto;

    switch (provider.toLowerCase()) {
      case 'twilio':
        parsed = this.parseTwilio(payload);
        break;
      default:
        parsed = this.parseGeneric(payload);
    }

    return parsed;
  }

  private parseTwilio(payload: Record<string, any>): IncomingMessageDto {
    // Twilio webhook format
    return {
      channel: MessageChannel.SMS,
      senderPhone: payload.From || payload.from,
      recipientPhone: payload.To || payload.to,
      content: payload.Body || payload.body || payload.MessageBody || '',
      threadId: payload.ConversationSid || payload.conversationSid,
      messageId: payload.MessageSid || payload.messageSid,
      metadata: payload,
    };
  }

  private parseGeneric(payload: Record<string, any>): IncomingMessageDto {
    // Generic parser for unknown SMS formats
    return {
      channel: MessageChannel.SMS,
      senderPhone: payload.from || payload.sender || payload.phoneNumber || payload.phone,
      recipientPhone: payload.to || payload.recipient || payload.destination,
      content: payload.body || payload.text || payload.message || payload.content || '',
      threadId: payload.threadId || payload.conversationId || payload.conversation_id,
      messageId: payload.messageId || payload.id || payload.sid,
      metadata: payload,
    };
  }
}

