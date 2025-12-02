import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ThreadDocument = Thread & Document;

@Schema({ timestamps: true })
export class Thread {
  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'Ticket ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true, unique: true })
  ticketId: Types.ObjectId;

  @ApiProperty({
    description: 'Customer ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Participant user IDs (users who can see internal messages)',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  participantUserIds: Types.ObjectId[];

  @ApiPropertyOptional({
    description: 'Participant group IDs (groups whose members can see internal messages)',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Group' }], default: [] })
  participantGroupIds: Types.ObjectId[];

  @ApiProperty({ description: 'Whether thread is active', example: true })
  @Prop({ default: true })
  isActive: boolean;

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

export const ThreadSchema = SchemaFactory.createForClass(Thread);

// Index for faster lookups
ThreadSchema.index({ ticketId: 1, organizationId: 1 }, { unique: true }); // One thread per ticket
ThreadSchema.index({ customerId: 1, organizationId: 1 });
ThreadSchema.index({ participantUserIds: 1, organizationId: 1 });

