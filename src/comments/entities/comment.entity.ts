import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type CommentDocument = Comment & Document;

@Schema({ timestamps: true })
export class Comment {
  @ApiProperty({
    description: 'Comment content',
    example: 'This issue has been resolved.',
  })
  @Prop({ required: true })
  content: string;

  @ApiProperty({
    description: 'Whether comment is internal (only visible to agents/admins)',
    example: false,
  })
  @Prop({ default: false })
  isInternal: boolean;

  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'Author user ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @ApiProperty({ description: 'Ticket ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId: Types.ObjectId;

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

export const CommentSchema = SchemaFactory.createForClass(Comment);
