import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type CategoryDocument = Category & Document;

@Schema({ timestamps: true })
export class Category {
  @ApiProperty({ description: 'Category name', example: 'Technical Support' })
  @Prop({ required: true })
  name: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'Technical support related issues',
  })
  @Prop({ required: false })
  description?: string;

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

export const CategorySchema = SchemaFactory.createForClass(Category);

// Create compound index for name uniqueness within organization
CategorySchema.index({ name: 1, organizationId: 1 }, { unique: true });
