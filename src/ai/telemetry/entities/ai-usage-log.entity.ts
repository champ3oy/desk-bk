import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AIUsageLogDocument = AIUsageLog & Document;

@Schema({ timestamps: true })
export class AIUsageLog {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: false,
  })
  organizationId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  userId?: string;

  @Prop({ required: false })
  ticketId?: string;

  @Prop({ required: true })
  feature: string; // e.g., 'draft-response', 'sentiment', 'react-loop'

  @Prop({ required: true })
  provider: string; // e.g., 'google', 'openai'

  @Prop({ required: true })
  modelName: string;

  @Prop({ required: true, default: 0 })
  inputTokens: number;

  @Prop({ required: true, default: 0 })
  outputTokens: number;

  @Prop({ required: true, default: 0 })
  totalTokens: number;

  @Prop({ required: true })
  performanceMs: number;

  @Prop({ required: true, default: 0 })
  creditsUsed: number;

  @Prop({ required: true, default: 0 })
  wholesaleCost: number; // The actual cost in USD from the provider

  @Prop({ type: Object, required: false })
  metadata?: Record<string, any>;
}

export const AIUsageLogSchema = SchemaFactory.createForClass(AIUsageLog);

// Add indexes for efficient querying/reporting
AIUsageLogSchema.index({ organizationId: 1, createdAt: -1 });
AIUsageLogSchema.index({ feature: 1, createdAt: -1 });
AIUsageLogSchema.index({ modelName: 1 });
