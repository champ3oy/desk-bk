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

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    private usersService: UsersService,
  ) {}

  async create(
    createOrganizationDto: CreateOrganizationDto,
    userId: string,
  ): Promise<Organization> {
    // Users can create multiple organizations
    // Create the organization
    const organization = new this.organizationModel(createOrganizationDto);
    const savedOrganization = await organization.save();

    // Get user to check if they have a primary organization
    const user = await this.usersService.findOne(userId);
    
    // If user doesn't have a primary organization, assign this one and make them admin
    if (!user.organizationId) {
      await this.usersService.update(
        userId,
        {
          organizationId: savedOrganization._id.toString(),
          role: UserRole.ADMIN,
        },
        undefined, // undefined = no organization filter
      );
    } else {
      // User already has a primary org, but they can still create more
      // They become admin of this new org (we could track this in a separate table later)
      // For now, we'll just create the org - the user's primary orgId stays the same
    }

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

    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    return organization;
  }

  async remove(id: string): Promise<void> {
    const organization = await this.findOne(id);
    await this.organizationModel.findByIdAndDelete(id).exec();
  }
}

