import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SmartCacheDocument = SmartCache & Document;

@Schema({ timestamps: true })
export class SmartCache {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ required: true })
  rawQuery: string;

  @Prop({ required: true })
  cachedResponse: string;

  @Prop({ type: [Number], required: true, select: false })
  queryEmbedding: number[];

  @Prop({ required: false })
  kbVersion: string;

  @Prop({ type: Object, required: false })
  metadata: Record<string, any>;
}

export const SmartCacheSchema = SchemaFactory.createForClass(SmartCache);
// Add a text index for literal matches if needed, but we'll use in-memory for hot routes
SmartCacheSchema.index({ organizationId: 1, rawQuery: 1 });
