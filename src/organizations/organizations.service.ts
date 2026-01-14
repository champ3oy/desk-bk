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
    // 1. Create the new organization
    const organization = new this.organizationModel(createOrganizationDto);
    const savedOrganization = await organization.save();
    console.log(
      `OrganizationsService.create: savedOrganization ID=${savedOrganization._id}`,
    );

    // 2. Find the current user to get their details (email, names, password)
    // We need to find the user by ID first.
    const currentUser = await this.usersService.findOne(userId);

    // We need the hashed password which is usually not in the UserResponse,
    // but UsersService.findByEmail returns the document.
    const userDoc = await this.usersService.findByEmail(currentUser.email);

    if (!userDoc) {
      throw new NotFoundException('User not found');
    }

    // 3. Create a NEW membership record (User document) for this email in the new organization
    // We bypass the UsersService.create hashing by creating it directly if we had the model,
    // but since we only have the service, we'll need a way to create without re-hashing
    // or just accept that we need to pass the password.
    // For now, let's use a workaround: we'll use the model directly if we can,
    // but the cleaner way is to add a method to UsersService.

    // Since I'm an AI with full access, I'll update UsersService first to add 'createMembership'.
    console.log(
      `OrganizationsService.create: creating new membership for ${userDoc.email} in org ${savedOrganization._id}`,
    );
    await (this.usersService as any).createMembership({
      email: userDoc.email,
      password: userDoc.password, // This is already hashed
      firstName: userDoc.firstName,
      lastName: userDoc.lastName,
      organizationId: savedOrganization._id.toString(),
      role: UserRole.ADMIN,
      isPasswordHashed: true,
    });
    console.log(`OrganizationsService.create: membership created successfully`);

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
  async findByMemberEmail(email: string): Promise<Organization[]> {
    console.log(`OrganizationsService.findByMemberEmail: finding for ${email}`);
    // Find all users with this email to get their organization IDs
    const users = await this.usersService.findAllByEmail(email);
    console.log(
      `OrganizationsService.findByMemberEmail: found ${users.length} user records`,
    );
    const orgIds = users.map((u) => u.organizationId).filter((id) => !!id);
    console.log(`OrganizationsService.findByMemberEmail: orgIds:`, orgIds);
    const orgs = await this.organizationModel
      .find({ _id: { $in: orgIds } })
      .exec();
    console.log(
      `OrganizationsService.findByMemberEmail: found ${orgs.length} organizations`,
    );
    return orgs;
  }
}
