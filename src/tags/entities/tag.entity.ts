import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type TagDocument = Tag & Document;

@Schema({ timestamps: true })
export class Tag {
  @ApiProperty({ description: 'Tag name', example: 'urgent' })
  @Prop({ required: true })
  name: string;

  @ApiPropertyOptional({
    description: 'Tag color (hex code)',
    example: '#FF0000',
  })
  @Prop({ required: false })
  color?: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

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

export const TagSchema = SchemaFactory.createForClass(Tag);

// Create compound index for name uniqueness within organization
TagSchema.index({ name: 1, organizationId: 1 }, { unique: true });
