import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type InvoiceDocument = Invoice & Document;

@Schema({ timestamps: true })
export class Invoice {
  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'Invoice Number', example: 'INV-2024-001' })
  @Prop({ required: true })
  invoiceNumber: string;

  @ApiProperty({ description: 'Amount', example: 50.0 })
  @Prop({ required: true })
  amount: number;

  @ApiProperty({ description: 'Currency', example: 'USD' })
  @Prop({ default: 'USD' })
  currency: string;

  @ApiProperty({ description: 'Status', example: 'paid' })
  @Prop({ default: 'pending', enum: ['paid', 'pending', 'failed', 'void'] })
  status: string;

  @ApiProperty({ description: 'Date', example: '2024-01-01' })
  @Prop({ required: true })
  date: Date;

  @ApiProperty({ description: 'PDF URL', required: false })
  @Prop()
  pdfUrl?: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ organizationId: 1 });
