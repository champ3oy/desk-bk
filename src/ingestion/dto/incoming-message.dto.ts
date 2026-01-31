import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageChannel } from '../../threads/entities/message.entity';

export class IncomingMessageDto {
  @ApiProperty({
    description: 'Communication channel',
    enum: MessageChannel,
    example: MessageChannel.EMAIL,
  })
  channel: MessageChannel;

  @ApiProperty({
    description: 'Sender email address',
    example: 'customer@example.com',
  })
  senderEmail?: string;

  @ApiPropertyOptional({
    description: 'Sender phone number',
    example: '+1234567890',
  })
  senderPhone?: string;

  @ApiPropertyOptional({ description: 'Sender name', example: 'John Doe' })
  senderName?: string;

  @ApiProperty({
    description: 'Recipient email address',
    example: 'support@acme.com',
  })
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'Recipient phone number',
    example: '+1987654321',
  })
  recipientPhone?: string;

  @ApiPropertyOptional({
    description: 'Message subject',
    example: 'Need help with login',
  })
  subject?: string;

  @ApiProperty({
    description: 'Message body/content',
    example: 'I cannot log in to my account',
  })
  content: string;

  @ApiPropertyOptional({
    description: 'Raw message body (e.g. HTML)',
    example: '<p>I cannot log in...</p>',
  })
  rawBody?: string;

  @ApiPropertyOptional({
    description: 'Email headers (for email messages)',
    additionalProperties: true,
    example: {
      'in-reply-to': '<message-id@example.com>',
      references: '<message-id@example.com>',
    },
  })
  headers?: Record<string, string | string[]>;

  @ApiPropertyOptional({
    description: 'Message ID from provider (for threading)',
    example: '<message-id@example.com>',
  })
  messageId?: string;

  @ApiPropertyOptional({
    description: 'In-Reply-To header value',
    example: '<message-id@example.com>',
  })
  inReplyTo?: string;

  @ApiPropertyOptional({
    description: 'References header value',
    example: '<message-id@example.com>',
  })
  references?: string;

  @ApiPropertyOptional({
    description: 'Thread/conversation ID (for SMS/WhatsApp)',
    example: 'thread-123',
  })
  threadId?: string;

  @ApiPropertyOptional({
    description: 'Provider-specific metadata',
    additionalProperties: true,
  })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Array of attachment objects',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        originalName: { type: 'string' },
        mimeType: { type: 'string' },
        size: { type: 'number' },
        path: { type: 'string' },
      },
    },
  })
  attachments?: Array<{
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    path: string;
    contentId?: string;
  }>;
}
