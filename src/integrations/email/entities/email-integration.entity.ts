import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type EmailIntegrationDocument = EmailIntegration & Document;

export enum EmailIntegrationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
  NEEDS_REAUTH = 'needs_reauth',
}

export enum EmailProvider {
  GMAIL = 'gmail',
  OUTLOOK = 'outlook', // Future proofing
}

@Schema({ timestamps: true })
export class EmailIntegration {
  @ApiProperty({ description: 'Organization ID' })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'Connected email address' })
  @Prop({ required: true })
  email: string;

  @ApiProperty({ description: 'Email provider' })
  @Prop({ required: true, enum: EmailProvider, default: EmailProvider.GMAIL })
  provider: EmailProvider;

  @ApiProperty({ description: 'Integration status' })
  @Prop({
    required: true,
    enum: EmailIntegrationStatus,
    default: EmailIntegrationStatus.ACTIVE,
  })
  status: EmailIntegrationStatus;

  @ApiProperty({ description: 'Whether integration is active' })
  @Prop({ required: true, default: true })
  isActive: boolean;

  // Sensitive data (Tokens) - In a real prod app, these should be encrypted
  @Prop({ required: true })
  accessToken: string;

  @Prop({ required: true })
  refreshToken: string;

  @Prop({ required: false })
  expiryDate?: Date;

  @Prop({ type: [String], default: [] })
  scopes: string[];

  // For sync tracking
  @Prop({ required: false })
  historyId?: string; // Used by Gmail for partial sync

  @Prop({ required: false })
  deltaLink?: string; // Used by Outlook for delta sync

  @Prop({ required: false })
  subscriptionId?: string; // Used by Outlook for webhook subscriptions (optional)

  @Prop({ required: false })
  lastSyncedAt?: Date;
}

export const EmailIntegrationSchema =
  SchemaFactory.createForClass(EmailIntegration);

// Index for looking up integration by email
EmailIntegrationSchema.index({ email: 1 });
// Index for looking up integrations by organization
EmailIntegrationSchema.index({ organizationId: 1 });
