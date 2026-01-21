import { Injectable } from '@nestjs/common';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { MessageChannel } from '../../threads/entities/message.entity';

@Injectable()
export class EmailParser {
  /**
   * Parse email webhook payload into normalized IncomingMessageDto
   * Supports common email providers (SendGrid, Mailgun, etc.)
   */
  parse(payload: Record<string, any>, provider: string): IncomingMessageDto {
    let parsed: IncomingMessageDto;

    switch (provider.toLowerCase()) {
      case 'sendgrid':
        parsed = this.parseSendGrid(payload);
        break;
      case 'mailgun':
        parsed = this.parseMailgun(payload);
        break;
      case 'gmail-polling':
      case 'outlook-polling':
        // Payload is already an IncomingMessageDto from polling services
        parsed = payload as IncomingMessageDto;
        break;
      default:
        parsed = this.parseGeneric(payload);
    }

    return parsed;
  }

  private parseSendGrid(payload: Record<string, any>): IncomingMessageDto {
    // SendGrid webhook format
    const email = payload.email || payload.from || '';
    const [senderEmail, senderName] = this.parseEmailAddress(email);
    const recipientEmail = payload.to || payload.recipient || '';

    return {
      channel: MessageChannel.EMAIL,
      senderEmail,
      senderName,
      recipientEmail,
      subject: payload.subject || '',
      content: this.extractTextBody(payload),
      rawBody: this.extractHtmlBody(payload),
      headers: this.parseHeaders(payload.headers || payload),
      messageId: payload['message-id'] || payload.messageId,
      inReplyTo: payload['in-reply-to'] || payload.inReplyTo,
      references: payload.references,
      metadata: payload,
      attachments: this.extractAttachments(payload),
    };
  }

  private parseMailgun(payload: Record<string, any>): IncomingMessageDto {
    // Mailgun webhook format
    const sender = payload.sender || payload.from || '';
    const [senderEmail, senderName] = this.parseEmailAddress(sender);
    const recipientEmail =
      payload.recipient || payload['message-headers']?.['To'] || '';

    return {
      channel: MessageChannel.EMAIL,
      senderEmail,
      senderName,
      recipientEmail,
      subject: payload.subject || payload['message-headers']?.['Subject'] || '',
      content: this.extractTextBody(payload),
      rawBody: this.extractHtmlBody(payload),
      headers: payload['message-headers'] || {},
      messageId:
        payload['Message-Id'] || payload['message-headers']?.['Message-Id'],
      inReplyTo:
        payload['In-Reply-To'] || payload['message-headers']?.['In-Reply-To'],
      references:
        payload['References'] || payload['message-headers']?.['References'],
      metadata: payload,
      attachments: this.extractAttachments(payload),
    };
  }

  private parseGeneric(payload: Record<string, any>): IncomingMessageDto {
    // Generic parser for unknown formats
    const sender = payload.from || payload.sender || payload.email || '';
    const [senderEmail, senderName] = this.parseEmailAddress(sender);
    const recipientEmail =
      payload.to || payload.recipient || payload.destination || '';

    return {
      channel: MessageChannel.EMAIL,
      senderEmail,
      senderName,
      recipientEmail,
      subject: payload.subject || payload.title || '',
      content: this.extractTextBody(payload),
      rawBody: this.extractHtmlBody(payload),
      headers: payload.headers || {},
      messageId: payload.messageId || payload['message-id'] || payload.id,
      inReplyTo:
        payload.inReplyTo || payload['in-reply-to'] || payload['In-Reply-To'],
      references: payload.references || payload.References,
      metadata: payload,
      attachments: this.extractAttachments(payload),
    };
  }

  /**
   * Parse email address string into email and name
   * Examples:
   * - "John Doe <john@example.com>" -> { email: "john@example.com", name: "John Doe" }
   * - "john@example.com" -> { email: "john@example.com", name: undefined }
   */
  private parseEmailAddress(address: string): [string, string?] {
    if (!address) {
      return ['', undefined];
    }

    const match = address.match(/^(.+?)\s*<(.+?)>$|^(.+)$/);
    if (match) {
      if (match[2]) {
        // Format: "Name <email@example.com>"
        return [match[2].trim(), match[1].trim().replace(/^["']|["']$/g, '')];
      } else if (match[3]) {
        // Format: "email@example.com"
        return [match[3].trim(), undefined];
      }
    }

    return [address.trim(), undefined];
  }

  /**
   * Extract message content from various payload formats
   */
  /**
   * Extract plain text content
   */
  private extractTextBody(payload: Record<string, any>): string {
    return (
      payload.text ||
      payload['text-plain'] ||
      payload['body-plain'] ||
      payload.body ||
      payload.content ||
      payload.message ||
      ''
    );
  }

  /**
   * Extract HTML content
   */
  private extractHtmlBody(payload: Record<string, any>): string {
    return payload.html || payload['body-html'] || payload['text-html'] || '';
  }

  /**
   * Parse headers from various formats
   */
  private parseHeaders(headers: any): Record<string, string | string[]> {
    if (!headers) {
      return {};
    }

    if (typeof headers === 'string') {
      // Headers as string, try to parse
      const parsed: Record<string, string> = {};
      headers.split('\n').forEach((line: string) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          parsed[key] = value;
        }
      });
      return parsed;
    }

    if (Array.isArray(headers)) {
      // Headers as array of [key, value] pairs
      const parsed: Record<string, string> = {};
      headers.forEach(([key, value]: [string, string]) => {
        parsed[key] = value;
      });
      return parsed;
    }

    return headers;
  }

  /**
   * Extract attachment information
   */
  /**
   * Extract attachment information
   */
  private extractAttachments(payload: Record<string, any>): any[] {
    const attachments: any[] = [];

    if (payload.attachments) {
      if (Array.isArray(payload.attachments)) {
        payload.attachments.forEach((att: any) => {
          if (typeof att === 'string') {
            attachments.push({
              filename: 'attachment',
              originalName: 'attachment',
              mimeType: 'application/octet-stream',
              size: 0,
              path: att,
            });
          } else if (att.url || att.id || att.filename) {
            attachments.push({
              filename: att.filename || att.id || 'attachment',
              originalName: att.filename || att.id || 'attachment',
              mimeType: att.contentType || 'application/octet-stream',
              size: att.size || 0,
              path: att.url || '',
            });
          }
        });
      }
    }

    if (payload['attachment-count'] && payload['attachment-count'] > 0) {
      // Some providers give attachment count but URLs are in separate fields
      for (let i = 1; i <= payload['attachment-count']; i++) {
        const attUrl = payload[`attachment-${i}`] || payload[`attachment${i}`];
        if (attUrl) {
          attachments.push({
            filename: `attachment-${i}`,
            originalName: `attachment-${i}`,
            mimeType: 'application/octet-stream',
            size: 0,
            path: attUrl,
          });
        }
      }
    }

    return attachments;
  }
}
