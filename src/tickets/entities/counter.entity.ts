import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CounterDocument = Counter & Document;

@Schema()
export class Counter {
  @Prop({ required: true })
  name: string; // e.g., 'ticket_number'

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);

// Ensure unique index on name + organizationId
CounterSchema.index({ name: 1, organizationId: 1 }, { unique: true });
