import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../users/entities/user.entity';

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export type InvitationDocument = Invitation & Document;

@Schema({ timestamps: true })
export class Invitation {
  @ApiProperty({ description: 'Invitation token', example: 'abc123-def456-ghi789' })
  @Prop({ required: true, unique: true, index: true })
  token: string;

  @ApiProperty({ description: 'Invitee email', example: 'user@example.com' })
  @Prop({ required: true })
  email: string;

  @ApiProperty({ description: 'First name', example: 'John' })
  @Prop({ required: true })
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Doe' })
  @Prop({ required: true })
  lastName: string;

  @ApiProperty({
    description: 'User role for the invitation',
    enum: UserRole,
    example: UserRole.AGENT,
  })
  @Prop({
    type: String,
    enum: UserRole,
    required: true,
  })
  role: UserRole;

  @ApiProperty({ description: 'Organization ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'User ID who sent the invitation', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedBy: Types.ObjectId;

  @ApiProperty({
    description: 'Invitation status',
    enum: InvitationStatus,
    example: InvitationStatus.PENDING,
  })
  @Prop({
    type: String,
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status: InvitationStatus;

  @ApiProperty({
    description: 'Expiration date',
    example: '2024-01-08T00:00:00.000Z',
  })
  @Prop({ required: true })
  expiresAt: Date;

  @ApiPropertyOptional({
    description: 'Acceptance timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Prop({ required: false })
  acceptedAt?: Date;

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

export const InvitationSchema = SchemaFactory.createForClass(Invitation);

// Index for faster lookups
InvitationSchema.index({ email: 1, organizationId: 1, status: 1 });
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

