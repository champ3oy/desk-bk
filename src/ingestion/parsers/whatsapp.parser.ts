import { Injectable } from '@nestjs/common';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { MessageChannel } from '../../threads/entities/message.entity';

@Injectable()
export class WhatsAppParser {
  /**
   * Parse WhatsApp webhook payload into normalized IncomingMessageDto
   * Supports Meta WhatsApp Business API
   */
  parse(payload: Record<string, any>, provider: string): IncomingMessageDto {
    let parsed: IncomingMessageDto;

    switch (provider.toLowerCase()) {
      case 'meta':
      case 'whatsapp':
        parsed = this.parseMeta(payload);
        break;
      default:
        parsed = this.parseGeneric(payload);
    }

    return parsed;
  }

  private parseMeta(payload: Record<string, any>): IncomingMessageDto {
    // Meta WhatsApp Business API webhook format
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    const senderPhone = message?.from || value?.from;
    const recipientPhone = value?.metadata?.phone_number_id || entry?.id;

    const attachments: any[] = [];
    if (message?.type === 'image' && message.image) {
      attachments.push({
        filename: `whatsapp_image_${message.image.id}.jpg`,
        originalName: `whatsapp_image_${message.image.id}.jpg`,
        mimeType: message.image.mime_type || 'image/jpeg',
        size: 0,
        path: message.image.url || '', // Note: Meta API requires a separate GET request for the actual URL, but we'll assume it's here or provided by a proxy
      });
    }

    return {
      channel: MessageChannel.WHATSAPP,
      senderPhone,
      recipientPhone,
      senderName: contact?.profile?.name,
      content: message?.text?.body || message?.caption || '',
      threadId: message?.context?.from || value?.conversation?.id,
      messageId: message?.id,
      attachments,
      metadata: payload,
    };
  }

  private parseGeneric(payload: Record<string, any>): IncomingMessageDto {
    // Generic parser for unknown WhatsApp formats
    return {
      channel: MessageChannel.WHATSAPP,
      senderPhone:
        payload.from || payload.sender || payload.phoneNumber || payload.phone,
      recipientPhone: payload.to || payload.recipient || payload.destination,
      senderName: payload.name || payload.senderName,
      content:
        payload.body ||
        payload.text ||
        payload.message ||
        payload.content ||
        '',
      threadId:
        payload.threadId || payload.conversationId || payload.conversation_id,
      messageId: payload.messageId || payload.id || payload.wa_id,
      metadata: payload,
    };
  }
}
