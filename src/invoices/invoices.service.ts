import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './entities/invoice.entity';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
  ) {}

  async create(createInvoiceDto: any): Promise<Invoice> {
    const createdInvoice = new this.invoiceModel(createInvoiceDto);
    return createdInvoice.save();
  }

  async findAll(organizationId: string): Promise<Invoice[]> {
    return this.invoiceModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ date: -1 })
      .exec();
  }

  async findOne(id: string): Promise<Invoice | null> {
    return this.invoiceModel.findById(id).exec();
  }

  async generateMockInvoices(organizationId: string) {
    const count = await this.invoiceModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
    });
    if (count > 0) return;

    // Generate some mock previous invoices
    const months = ['Sep', 'Oct', 'Nov', 'Dec'];
    const invoices = months.map((month, index) => ({
      organizationId: new Types.ObjectId(organizationId),
      invoiceNumber: `INV-2024-${month.toUpperCase()}`,
      amount: 600.0,
      currency: 'GHS',
      status: 'paid',
      date: new Date(`2024-${9 + index}-15`),
    }));

    await this.invoiceModel.insertMany(invoices);
  }
}
