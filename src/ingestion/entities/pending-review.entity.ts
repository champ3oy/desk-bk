import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageChannel } from '../../threads/entities/message.entity';

export enum PendingReviewStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
  IGNORED = 'ignored',
}

export type PendingReviewDocument = PendingReview & Document;

@Schema({ timestamps: true })
export class PendingReview {
  @ApiProperty({
    description: 'Communication channel',
    enum: MessageChannel,
    example: MessageChannel.EMAIL,
  })
  @Prop({
    type: String,
    enum: MessageChannel,
    required: true,
  })
  channel: MessageChannel;

  @ApiProperty({
    description: 'Reason for manual review',
    example: 'Organization not found',
  })
  @Prop({ required: true })
  reason: string;

  @ApiProperty({
    description: 'Raw incoming message data',
    additionalProperties: true,
  })
  @Prop({ type: Object, required: true })
  rawMessage: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Sender email address',
    example: 'customer@example.com',
  })
  @Prop({ required: false })
  senderEmail?: string;

  @ApiPropertyOptional({
    description: 'Sender phone number',
    example: '+1234567890',
  })
  @Prop({ required: false })
  senderPhone?: string;

  @ApiPropertyOptional({
    description: 'Recipient email address',
    example: 'support@acme.com',
  })
  @Prop({ required: false })
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'Recipient phone number',
    example: '+1987654321',
  })
  @Prop({ required: false })
  recipientPhone?: string;

  @ApiPropertyOptional({
    description: 'Message content',
    example: 'I need help',
  })
  @Prop({ required: false })
  content?: string;

  @ApiProperty({
    description: 'Review status',
    enum: PendingReviewStatus,
    example: PendingReviewStatus.PENDING,
  })
  @Prop({
    type: String,
    enum: PendingReviewStatus,
    default: PendingReviewStatus.PENDING,
  })
  status: PendingReviewStatus;

  @ApiPropertyOptional({
    description: 'Resolved organization ID (if manually resolved)',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ required: false })
  resolvedOrganizationId?: string;

  @ApiPropertyOptional({
    description: 'Notes from manual review',
    example: 'Assigned to organization X',
  })
  @Prop({ required: false })
  notes?: string;

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

export const PendingReviewSchema = SchemaFactory.createForClass(PendingReview);

// Index for faster lookups
PendingReviewSchema.index({ status: 1, createdAt: -1 });
PendingReviewSchema.index({ channel: 1, status: 1 });
