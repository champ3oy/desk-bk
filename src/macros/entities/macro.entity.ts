import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MacroVisibility {
  PRIVATE = 'private',
  TEAM = 'team',
  ORGANIZATION = 'organization',
}

export type MacroDocument = Macro & Document;

@Schema({ timestamps: true })
export class Macro {
  @ApiProperty({ description: 'Macro title', example: 'Welcome New Customer' })
  @Prop({ required: true })
  title: string;

  @ApiProperty({ description: 'Shortcut trigger', example: '/welcome' })
  @Prop({ required: true })
  shortcut: string;

  @ApiProperty({
    description: 'Macro content/message',
    example: 'Hello! Welcome to our support. How can I help you today?',
  })
  @Prop({ required: true })
  content: string;

  @ApiProperty({
    description: 'Visibility level',
    enum: MacroVisibility,
    example: MacroVisibility.PRIVATE,
  })
  @Prop({
    type: String,
    enum: MacroVisibility,
    default: MacroVisibility.PRIVATE,
  })
  visibility: MacroVisibility;

  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({
    description: 'Creator user ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Team IDs this macro is shared with (for team visibility)',
    example: ['507f1f77bcf86cd799439011'],
  })
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Group' }], default: [] })
  sharedWithTeams?: Types.ObjectId[];

  @ApiProperty({
    description: 'Number of times this macro has been used',
    example: 42,
  })
  @Prop({ default: 0 })
  usageCount: number;

  @ApiPropertyOptional({
    description: 'Last time this macro was used',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Prop()
  lastUsedAt?: Date;

  @ApiProperty({
    description: 'Whether the macro is active',
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

export const MacroSchema = SchemaFactory.createForClass(Macro);

// Create indexes
MacroSchema.index({ organizationId: 1, createdBy: 1 });
MacroSchema.index({ organizationId: 1, visibility: 1 });
MacroSchema.index({ shortcut: 1, organizationId: 1 });
MacroSchema.index({ organizationId: 1, isActive: 1 });
