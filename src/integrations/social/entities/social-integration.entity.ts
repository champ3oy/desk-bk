import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type SocialIntegrationDocument = SocialIntegration & Document;

export enum SocialProvider {
  WHATSAPP = 'whatsapp',
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
}

export enum SocialIntegrationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  ERROR = 'error',
}

@Schema({ timestamps: true })
export class SocialIntegration {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Organization' })
  organizationId: Types.ObjectId;

  @Prop({ required: true, enum: SocialProvider })
  provider: SocialProvider;

  @Prop({ required: true })
  name: string;

  // WhatsApp specific fields
  @Prop()
  wabaId?: string; // WhatsApp Business Account ID

  @Prop()
  phoneNumberId?: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  businessId?: string;

  // Instagram specific fields
  @Prop()
  instagramAccountId?: string;

  @Prop()
  instagramUsername?: string;

  // Facebook specific fields
  @Prop()
  facebookPageId?: string;

  @Prop()
  facebookPageName?: string;

  // Common OAuth fields
  @Prop()
  accessToken?: string;

  @Prop()
  refreshToken?: string;

  @Prop()
  tokenExpiresAt?: Date;

  @Prop({
    enum: SocialIntegrationStatus,
    default: SocialIntegrationStatus.PENDING,
  })
  status: SocialIntegrationStatus;

  @Prop()
  lastSyncedAt?: Date;

  @Prop()
  errorMessage?: string;

  @Prop({ default: true })
  isActive: boolean;

  // Metadata
  @ApiPropertyOptional({ description: 'Metadata' })
  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Default agent ID for auto-assignment' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  defaultAgentId?: Types.ObjectId;
}

export const SocialIntegrationSchema =
  SchemaFactory.createForClass(SocialIntegration);

// Indexes
SocialIntegrationSchema.index({ organizationId: 1 });
SocialIntegrationSchema.index({ provider: 1 });
SocialIntegrationSchema.index({ wabaId: 1 });
SocialIntegrationSchema.index({ instagramAccountId: 1 });
SocialIntegrationSchema.index({ facebookPageId: 1 });
