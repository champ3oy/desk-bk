import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MessageChannel {
  EMAIL = 'email',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
  WIDGET = 'widget',
  PLATFORM = 'platform', // Direct platform messaging
}

export enum MessageAuthorType {
  USER = 'user',
  CUSTOMER = 'customer',
  AI = 'ai',
}

export enum MessageType {
  EXTERNAL = 'external', // Visible to customer
  INTERNAL = 'internal', // Not visible to customer
}

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @ApiProperty({
    description: 'Thread ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Thread', required: true })
  threadId: Types.ObjectId;

  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({
    description:
      'Message type - external (visible to customer) or internal (not visible to customer)',
    enum: MessageType,
    example: MessageType.EXTERNAL,
  })
  @Prop({
    type: String,
    enum: MessageType,
    required: true,
    default: MessageType.EXTERNAL,
  })
  messageType: MessageType;

  @ApiProperty({
    description: 'Author type',
    enum: MessageAuthorType,
    example: MessageAuthorType.USER,
  })
  @Prop({
    type: String,
    enum: MessageAuthorType,
    required: true,
  })
  authorType: MessageAuthorType;

  @ApiProperty({
    description: 'Author ID (User ID or Customer ID)',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ required: true })
  authorId: Types.ObjectId;

  @ApiProperty({
    description: 'Message content',
    example: 'Hello, I can help you with this issue.',
  })
  @Prop({ required: true })
  content: string;

  @ApiProperty({
    description: 'Communication channel used to send/receive this message',
    enum: MessageChannel,
    example: MessageChannel.PLATFORM,
  })
  @Prop({
    type: String,
    enum: MessageChannel,
    required: true,
    default: MessageChannel.PLATFORM,
  })
  channel: MessageChannel;

  @ApiPropertyOptional({
    description: 'Array of user IDs who read the message',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  readBy: Types.ObjectId[];

  @ApiProperty({ description: 'Whether message is read', example: false })
  @Prop({ default: false })
  isRead: boolean;

  @ApiPropertyOptional({
    description:
      'External message ID from provider (for email threading, SMS/WhatsApp IDs)',
    example: '<message-id@example.com>',
  })
  @Prop({ required: false, index: true })
  externalMessageId?: string;

  @ApiPropertyOptional({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;

  @ApiPropertyOptional({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Index for faster lookups
MessageSchema.index({ threadId: 1, createdAt: -1 });
MessageSchema.index({ organizationId: 1, createdAt: -1 });
MessageSchema.index({ externalMessageId: 1, organizationId: 1 });
