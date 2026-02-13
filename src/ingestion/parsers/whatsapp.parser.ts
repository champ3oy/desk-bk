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
    // Check if this is a pre-normalized payload from webhooks.controller.ts
    // (has flat structure with 'from', 'to', 'text' fields)
    if (
      payload.from &&
      (payload.to || payload.phoneNumberId) &&
      !payload.entry
    ) {
      // This is the normalized format from webhooks.controller.ts
      const attachments: any[] = [];
      if (
        payload.mediaType &&
        (payload.mediaUrl || payload.originalPayload?.[payload.mediaType]?.id)
      ) {
        const mediaId = payload.originalPayload?.[payload.mediaType]?.id;
        attachments.push({
          filename: `whatsapp_${payload.mediaType}_${payload.id || Date.now()}.${this.getExtension(payload.mediaType)}`,
          originalName: `whatsapp_${payload.mediaType}_${payload.id || Date.now()}.${this.getExtension(payload.mediaType)}`,
          mimeType: this.getMimeType(payload.mediaType),
          size: 0,
          path: payload.mediaUrl || '',
          mediaId: mediaId,
        });
      }

      let content = payload.text || '';
      if (!content && attachments.length > 0) {
        content = '[Attachment]';
      } else if (!content) {
        content = '[Message]';
      }

      return {
        channel: MessageChannel.WHATSAPP,
        senderPhone: payload.from,
        recipientPhone: payload.to, // This is the display_phone_number
        senderName: payload.fromName,
        content,
        threadId: payload.originalPayload?.context?.from,
        messageId: payload.id,
        attachments,
        metadata: {
          ...payload,
          phoneNumberId: payload.phoneNumberId, // Keep phoneNumberId for sending replies
        },
      };
    }

    // Raw Meta WhatsApp Business API webhook format
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    const senderPhone = message?.from || value?.from;
    // Use display_phone_number (the actual phone number) for organization resolution
    const recipientPhone =
      value?.metadata?.display_phone_number ||
      value?.metadata?.phone_number_id ||
      entry?.id;

    const attachments: any[] = [];
    if (message?.type && message[message.type]) {
      const media = message[message.type];
      const mediaId = media.id;
      const mediaMimeType = media.mime_type || this.getMimeType(message.type);
      const extension = this.getExtension(message.type);

      // Use original filename if provided (common for documents)
      const originalName =
        media.filename || `whatsapp_${message.type}_${mediaId}.${extension}`;

      attachments.push({
        filename: `whatsapp_${message.type}_${mediaId}.${extension}`,
        originalName: originalName,
        mimeType: mediaMimeType,
        size: 0,
        path: media.url || '',
        mediaId: mediaId,
      });
    }

    let content = message?.text?.body || message?.caption || '';
    if (!content) {
      if (attachments.length > 0) {
        content = '[Attachment]';
      } else if (message?.type) {
        content = `[${message.type}]`;
      } else {
        content = '[Message]';
      }
    }

    return {
      channel: MessageChannel.WHATSAPP,
      senderPhone,
      recipientPhone,
      senderName: contact?.profile?.name,
      content,
      threadId: message?.context?.from || value?.conversation?.id,
      messageId: message?.id,
      attachments,
      metadata: {
        ...payload,
        phoneNumberId: value?.metadata?.phone_number_id, // Keep phoneNumberId for sending replies
      },
    };
  }

  private getExtension(mediaType: string): string {
    switch (mediaType) {
      case 'image':
        return 'jpg';
      case 'video':
        return 'mp4';
      case 'audio':
        return 'ogg';
      case 'document':
        return 'pdf';
      default:
        return 'bin';
    }
  }

  private getMimeType(mediaType: string): string {
    switch (mediaType) {
      case 'image':
        return 'image/jpeg';
      case 'video':
        return 'video/mp4';
      case 'audio':
        return 'audio/ogg';
      case 'document':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
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
        '[Message]',
      threadId:
        payload.threadId || payload.conversationId || payload.conversation_id,
      messageId: payload.messageId || payload.id || payload.wa_id,
      metadata: payload,
    };
  }
}
