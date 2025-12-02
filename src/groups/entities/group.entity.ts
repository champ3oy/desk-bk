import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @ApiProperty({ description: 'Group name', example: 'Support Team A' })
  @Prop({ required: true })
  name: string;

  @ApiPropertyOptional({
    description: 'Group description',
    example: 'Primary support team',
  })
  @Prop({ required: false })
  description?: string;

  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Array of member user IDs',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    default: [],
  })
  memberIds: Types.ObjectId[];

  @ApiProperty({ description: 'Whether group is active', example: true })
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

export const GroupSchema = SchemaFactory.createForClass(Group);

// Create compound index for name uniqueness within organization
GroupSchema.index({ name: 1, organizationId: 1 }, { unique: true });

