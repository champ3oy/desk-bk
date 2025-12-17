import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type TrainingSourceDocument = TrainingSource & Document;

@Schema({ timestamps: true })
export class TrainingSource {
  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({
    description: 'Training source name',
    example: 'Product Manual',
  })
  @Prop({ required: true })
  name: string;

  @ApiProperty({
    description: 'Source type',
    enum: ['file', 'image', 'audio', 'text', 'url'],
    example: 'file',
  })
  @Prop({ required: true, enum: ['file', 'image', 'audio', 'text', 'url'] })
  type: string;

  @ApiProperty({
    description: 'Source content (text content or URL)',
    example: 'https://example.com/manual.pdf',
    required: false,
  })
  @Prop({ required: false })
  content?: string;

  @ApiProperty({
    description: 'File size (for non-text/url types)',
    example: '2.4 MB',
    required: false,
  })
  @Prop({ required: false })
  size?: string;

  @ApiProperty({
    description: 'Metadata (like file MIME type, encoding, etc)',
    required: false,
  })
  @Prop({ type: Object, required: false })
  metadata?: Record<string, any>;
}

export const TrainingSourceSchema =
  SchemaFactory.createForClass(TrainingSource);
