import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type AttachmentDocument = Attachment & Document;

@Schema({ timestamps: true })
export class Attachment {
  @ApiProperty({ description: 'Stored filename', example: 'abc123-def456.pdf' })
  @Prop({ required: true })
  filename: string;

  @ApiProperty({ description: 'Original filename', example: 'document.pdf' })
  @Prop({ required: true })
  originalName: string;

  @ApiProperty({ description: 'MIME type', example: 'application/pdf' })
  @Prop({ required: true })
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes', example: 1024 })
  @Prop({ required: true })
  size: number;

  @ApiProperty({ description: 'File storage path', example: '/uploads/abc123-def456.pdf' })
  @Prop({ required: true })
  path: string;

  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Ticket ID (if attached to ticket)',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: false })
  ticketId?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Comment ID (if attached to comment)',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Comment', required: false })
  commentId?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);
