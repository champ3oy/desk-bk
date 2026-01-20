import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export enum NotificationType {
  NEW_TICKET = 'new_ticket',
  REPLY = 'reply',
  MENTION = 'mention',
  SYSTEM = 'system',
}

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @ApiProperty({ description: 'User ID who receives the notification' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @ApiProperty({ enum: NotificationType })
  @Prop({
    type: String,
    enum: NotificationType,
    required: true,
  })
  type: NotificationType;

  @ApiProperty({ description: 'Notification title' })
  @Prop({ required: true })
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @Prop({ required: true })
  body: string;

  @ApiProperty({ description: 'Read status' })
  @Prop({ default: false })
  read: boolean;

  @ApiProperty({ description: 'Metadata for navigation etc' })
  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Update timestamp' })
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
