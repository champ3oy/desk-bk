import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type OrganizationDocument = Organization & Document;

@Schema({ timestamps: true })
export class Organization {
  @ApiProperty({ description: 'Organization name', example: 'Acme Corporation' })
  @Prop({ required: true })
  name: string;

  @ApiPropertyOptional({
    description: 'Organization description',
    example: 'A leading technology company',
  })
  @Prop({ required: false })
  description?: string;

  @ApiProperty({
    description: 'Whether organization is active',
    example: true,
  })
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

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

