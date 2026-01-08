import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';

import { InvoicesService } from '../invoices/invoices.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    private usersService: UsersService,
    private invoicesService: InvoicesService,
  ) {}

  // ... (create method remains unchanged)

  async create(
    createOrganizationDto: CreateOrganizationDto,
    userId: string,
  ): Promise<Organization> {
    const organization = new this.organizationModel(createOrganizationDto);
    const savedOrganization = await organization.save();

    const user = await this.usersService.findOne(userId);

    await this.usersService.update(
      userId,
      {
        organizationId: savedOrganization._id.toString(),
        role: UserRole.ADMIN,
      },
      undefined,
    );

    return savedOrganization;
  }

  async findAll(): Promise<Organization[]> {
    return this.organizationModel.find().exec();
  }

  async findOne(id: string): Promise<Organization> {
    const organization = await this.organizationModel.findById(id).exec();

    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    return organization;
  }

  async update(
    id: string,
    updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const organization = await this.organizationModel
      .findByIdAndUpdate(id, updateOrganizationDto, { new: true })
      .exec();

    if (updateOrganizationDto.widgetConfig) {
      console.log(
        `[OrganizationsService] Updating widget config for ${id}:`,
        JSON.stringify(updateOrganizationDto.widgetConfig, null, 2),
      );
    }

    if (organization?.widgetConfig) {
      console.log(
        `[OrganizationsService] Updated org widget config:`,
        JSON.stringify(organization.widgetConfig, null, 2),
      );
    }

    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    // Generate invoice if plan changed
    if (updateOrganizationDto.plan) {
      const plan = updateOrganizationDto.plan.toLowerCase();
      let amount = 0;
      switch (plan) {
        case 'starter':
          amount = 350;
          break;
        case 'professional':
          amount = 600;
          break;
        case 'enterprise':
          amount = 1200;
          break;
      }

      if (amount > 0) {
        await this.invoicesService.create({
          organizationId: new Types.ObjectId(id),
          invoiceNumber: `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
          amount,
          currency: 'GHS',
          status: 'paid',
          date: new Date(),
        });
      }
    }

    return organization;
  }

  async remove(id: string): Promise<void> {
    const organization = await this.findOne(id);
    await this.organizationModel.findByIdAndDelete(id).exec();
  }
  async addSupportEmail(id: string, email: string): Promise<void> {
    await this.organizationModel.updateOne(
      { _id: id },
      { $addToSet: { additionalEmails: email } },
    );
  }
}
