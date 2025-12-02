import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TicketStatus {
  OPEN = 'open',
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export type TicketDocument = Ticket & Document;

@Schema({ timestamps: true })
export class Ticket {
  @ApiProperty({ description: 'Ticket subject', example: 'Unable to login' })
  @Prop({ required: true })
  subject: string;

  @ApiProperty({
    description: 'Ticket description',
    example: 'I am unable to login to my account',
  })
  @Prop({ required: true })
  description: string;

  @ApiProperty({
    description: 'Ticket status',
    enum: TicketStatus,
    example: TicketStatus.OPEN,
  })
  @Prop({
    type: String,
    enum: TicketStatus,
    default: TicketStatus.OPEN,
  })
  status: TicketStatus;

  @ApiProperty({
    description: 'Ticket priority',
    enum: TicketPriority,
    example: TicketPriority.MEDIUM,
  })
  @Prop({
    type: String,
    enum: TicketPriority,
    default: TicketPriority.MEDIUM,
  })
  priority: TicketPriority;

  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'Customer ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Assigned user ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  assignedToId?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Assigned group ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Group', required: false })
  assignedToGroupId?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Category ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Category', required: false })
  categoryId?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Array of tag IDs',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Tag' }], default: [] })
  tagIds: Types.ObjectId[];

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

export const TicketSchema = SchemaFactory.createForClass(Ticket);
