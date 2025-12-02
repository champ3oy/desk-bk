import {
  Injectable,
  NotFoundException,
  ConflictException,
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
}

