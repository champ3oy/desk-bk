import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

import { TicketsService } from '../tickets/tickets.service';
import { ThreadsService } from '../threads/threads.service';
import { forwardRef, Inject } from '@nestjs/common';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private customerModel: Model<CustomerDocument>,
    @Inject(forwardRef(() => TicketsService))
    private ticketsService: TicketsService,
    @Inject(forwardRef(() => ThreadsService))
    private threadsService: ThreadsService,
  ) {}

  async create(
    createCustomerDto: CreateCustomerDto,
    organizationId: string,
  ): Promise<CustomerDocument> {
    const existingCustomer = await this.customerModel.findOne({
      email: createCustomerDto.email,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (existingCustomer) {
      throw new ConflictException(
        'Customer with this email already exists in this organization',
      );
    }

    const customer = new this.customerModel({
      ...createCustomerDto,
      organizationId: new Types.ObjectId(organizationId),
    });

    const savedCustomer = await customer.save();
    return savedCustomer;
  }

  async findAll(organizationId: string): Promise<CustomerDocument[]> {
    return this.customerModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  async findOne(id: string, organizationId: string): Promise<CustomerDocument> {
    const customer = await this.customerModel
      .findOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async update(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
    organizationId: string,
  ): Promise<CustomerDocument> {
    // If email is being updated, check for uniqueness
    if (updateCustomerDto.email) {
      const customer = await this.findOne(id, organizationId);
      if (updateCustomerDto.email !== customer.email) {
        const existingCustomer = await this.customerModel.findOne({
          email: updateCustomerDto.email,
          organizationId: new Types.ObjectId(organizationId),
        });

        if (existingCustomer) {
          throw new ConflictException(
            'Customer with this email already exists in this organization',
          );
        }
      }
    }

    const updatedCustomer = await this.customerModel
      .findOneAndUpdate(
        {
          _id: id,
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: updateCustomerDto },
        { new: true },
      )
      .exec();

    if (!updatedCustomer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return updatedCustomer;
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.customerModel
      .findOneAndDelete({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /**
   * Find customer by email within an organization
   */
  async findByEmail(
    email: string,
    organizationId: string,
  ): Promise<CustomerDocument | null> {
    return this.customerModel
      .findOne({
        email: email.toLowerCase().trim(),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /**
   * Find customer by phone number within an organization
   */
  async findByPhone(
    phone: string,
    organizationId: string,
  ): Promise<CustomerDocument | null> {
    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phone.replace(/\s|-|\(|\)/g, '');
    return this.customerModel
      .findOne({
        phone: { $regex: normalizedPhone, $options: 'i' },
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /**
   * Find customer by email or phone within an organization
   * Returns the first match found (email takes precedence)
   */
  async findByEmailOrPhone(
    email?: string,
    phone?: string,
    organizationId?: string,
  ): Promise<CustomerDocument | null> {
    if (!organizationId) {
      return null;
    }

    const orgId = new Types.ObjectId(organizationId);
    const query: any = { organizationId: orgId };

    if (email) {
      const emailMatch = await this.findByEmail(email, organizationId);
      if (emailMatch) {
        return emailMatch;
      }
    }

    if (phone) {
      return this.findByPhone(phone, organizationId);
    }

    return null;
  }

  /**
   * Find customer IDs matching a search term (name or email)
   */
  async findIdsBySearch(
    search: string,
    organizationId: string,
  ): Promise<Types.ObjectId[]> {
    const regex = new RegExp(search, 'i');
    const customers = await this.customerModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { company: regex },
        ],
      })
      .select('_id')
      .exec();

    return customers.map((c) => c._id as Types.ObjectId);
  }

  /**
   * Find or create a customer within an organization
   * Matches by email, phone, or externalId (if any match, returns existing customer)
   * Updates customer info if found but data differs
   */
  async findOrCreate(
    customerData: {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      externalId?: string; // For widget sessions without email
    },
    organizationId: string,
  ): Promise<CustomerDocument> {
    const orgId = new Types.ObjectId(organizationId);

    // Try to find existing customer by email, phone, or externalId
    let existingCustomer: CustomerDocument | null = null;

    if (customerData.email) {
      existingCustomer = await this.findByEmail(
        customerData.email,
        organizationId,
      );
    }

    if (!existingCustomer && customerData.phone) {
      existingCustomer = await this.findByPhone(
        customerData.phone,
        organizationId,
      );
    }

    // Check by externalId (for widget sessions)
    if (!existingCustomer && customerData.externalId) {
      existingCustomer = await this.customerModel
        .findOne({
          externalId: customerData.externalId,
          organizationId: orgId,
        })
        .exec();
    }

    if (existingCustomer) {
      // Update customer info if provided data differs
      let needsUpdate = false;
      const updates: any = {};

      if (
        customerData.email &&
        existingCustomer.email !== customerData.email.toLowerCase().trim()
      ) {
        // Email changed - but we found by phone, so update email
        updates.email = customerData.email.toLowerCase().trim();
        needsUpdate = true;
      }

      if (customerData.phone && existingCustomer.phone !== customerData.phone) {
        updates.phone = customerData.phone;
        needsUpdate = true;
      }

      if (
        customerData.firstName &&
        existingCustomer.firstName !== customerData.firstName
      ) {
        updates.firstName = customerData.firstName;
        needsUpdate = true;
      }

      if (
        customerData.lastName &&
        existingCustomer.lastName !== customerData.lastName
      ) {
        updates.lastName = customerData.lastName;
        needsUpdate = true;
      }

      if (
        customerData.company &&
        existingCustomer.company !== customerData.company
      ) {
        updates.company = customerData.company;
        needsUpdate = true;
      }

      if (needsUpdate) {
        Object.assign(existingCustomer, updates);
        return existingCustomer.save();
      }

      return existingCustomer;
    }

    // Create new customer
    // We can create a customer if we have email, externalId, OR phone (for WhatsApp/SMS users)
    if (
      !customerData.email &&
      !customerData.externalId &&
      !customerData.phone
    ) {
      throw new BadRequestException(
        'Email, phone, or externalId is required to create a customer',
      );
    }

    // First name and last name handling
    if (!customerData.firstName || !customerData.lastName) {
      if (customerData.email) {
        // Try to parse from email
        const emailParts = customerData.email.split('@')[0];
        const nameParts = emailParts.split(/[._-]/);
        customerData.firstName =
          customerData.firstName || nameParts[0] || 'Customer';
        customerData.lastName =
          customerData.lastName || nameParts.slice(1).join(' ') || '';
      } else if (customerData.phone) {
        // WhatsApp/SMS customer - use phone-based defaults
        customerData.firstName = customerData.firstName || 'WhatsApp';
        customerData.lastName = customerData.lastName || 'User';
      } else {
        // Widget customer without email
        customerData.firstName = customerData.firstName || 'Website';
        customerData.lastName = customerData.lastName || 'Visitor';
      }
    }

    const payload: any = {
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      phone: customerData.phone,
      company: customerData.company,
      externalId: customerData.externalId,
      organizationId: orgId,
      isActive: true,
    };

    if (customerData.email) {
      payload.email = customerData.email.toLowerCase().trim();
    }

    const newCustomer = new this.customerModel(payload);

    return newCustomer.save();
  }

  async merge(
    sourceCustomerId: string,
    targetCustomerId: string,
    organizationId: string,
  ): Promise<CustomerDocument> {
    const sourceCustomer = await this.findOne(sourceCustomerId, organizationId);
    const targetCustomer = await this.findOne(targetCustomerId, organizationId);

    // Reassign tickets
    await this.ticketsService.updateCustomer(
      sourceCustomerId,
      targetCustomerId,
      organizationId,
    );

    // Reassign threads and messages
    await this.threadsService.updateCustomerForThreads(
      sourceCustomerId,
      targetCustomerId,
      organizationId,
    );

    // Simple field merging strategy: fill missing fields in target from source
    let needsUpdate = false;
    if (!targetCustomer.phone && sourceCustomer.phone) {
      targetCustomer.phone = sourceCustomer.phone;
      needsUpdate = true;
    }
    if (!targetCustomer.company && sourceCustomer.company) {
      targetCustomer.company = sourceCustomer.company;
      needsUpdate = true;
    }
    // Note: externalId is tricky, only one can have it usually.
    // If target doesn't have it, we could move it, but it might be associated with a session.
    // Let's assume user knows what they are doing merging.

    if (needsUpdate) {
      await targetCustomer.save();
    }

    // Delete source customer
    await this.customerModel
      .findByIdAndDelete(new Types.ObjectId(sourceCustomerId))
      .exec();

    return targetCustomer;
  }
}
