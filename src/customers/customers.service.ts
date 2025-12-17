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

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private customerModel: Model<CustomerDocument>,
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
    const customer = await this.findOne(id, organizationId);

    if (
      updateCustomerDto.email &&
      updateCustomerDto.email !== customer.email
    ) {
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

    Object.assign(customer, updateCustomerDto);
    const savedCustomer = await customer.save();
    return savedCustomer;
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
   * Find or create a customer within an organization
   * Matches by email or phone (if either matches, returns existing customer)
   * Updates customer info if found but data differs
   */
  async findOrCreate(
    customerData: {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
    },
    organizationId: string,
  ): Promise<CustomerDocument> {
    const orgId = new Types.ObjectId(organizationId);

    // Try to find existing customer by email or phone
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

    if (existingCustomer) {
      // Update customer info if provided data differs
      let needsUpdate = false;
      const updates: any = {};

      if (customerData.email && existingCustomer.email !== customerData.email.toLowerCase().trim()) {
        // Email changed - but we found by phone, so update email
        updates.email = customerData.email.toLowerCase().trim();
        needsUpdate = true;
      }

      if (customerData.phone && existingCustomer.phone !== customerData.phone) {
        updates.phone = customerData.phone;
        needsUpdate = true;
      }

      if (customerData.firstName && existingCustomer.firstName !== customerData.firstName) {
        updates.firstName = customerData.firstName;
        needsUpdate = true;
      }

      if (customerData.lastName && existingCustomer.lastName !== customerData.lastName) {
        updates.lastName = customerData.lastName;
        needsUpdate = true;
      }

      if (customerData.company && existingCustomer.company !== customerData.company) {
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
    // Email is required for customer creation
    if (!customerData.email) {
      throw new BadRequestException('Email is required to create a customer');
    }

    // First name and last name are required
    if (!customerData.firstName || !customerData.lastName) {
      // Try to parse from email or use defaults
      const emailParts = customerData.email.split('@')[0];
      const nameParts = emailParts.split(/[._-]/);
      customerData.firstName = customerData.firstName || nameParts[0] || 'Customer';
      customerData.lastName = customerData.lastName || nameParts.slice(1).join(' ') || 'Unknown';
    }

    const newCustomer = new this.customerModel({
      email: customerData.email.toLowerCase().trim(),
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      phone: customerData.phone,
      company: customerData.company,
      organizationId: orgId,
      isActive: true,
    });

    return newCustomer.save();
  }
}

