import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type CustomerDocument = Customer & Document;

@Schema({ timestamps: true })
export class Customer {
  @ApiPropertyOptional({
    description: 'Customer email',
    example: 'customer@example.com',
  })
  @Prop({ required: false })
  email?: string;

  @ApiProperty({ description: 'First name', example: 'John' })
  @Prop({ required: true })
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Doe' })
  @Prop({ required: true })
  lastName: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiPropertyOptional({ description: 'Phone number', example: '+1234567890' })
  @Prop({ required: false })
  phone?: string;

  @ApiPropertyOptional({ description: 'Company name', example: 'Acme Corp' })
  @Prop({ required: false })
  company?: string;

  @ApiProperty({ description: 'Whether customer is active', example: true })
  @Prop({ default: true })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'External ID for widget sessions',
    example: 'session_abc123',
  })
  @Prop({ required: false })
  externalId?: string;

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

export const CustomerSchema = SchemaFactory.createForClass(Customer);

// Create compound index for email uniqueness within organization
CustomerSchema.index(
  { email: 1, organizationId: 1 },
  { unique: true, sparse: true },
);

// Index for externalId lookup
CustomerSchema.index({ externalId: 1, organizationId: 1 }, { sparse: true });
