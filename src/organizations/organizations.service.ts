import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { ElevenLabsService } from '../integrations/elevenlabs/elevenlabs.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    private usersService: UsersService,
    private invoicesService: InvoicesService,
    private elevenLabsService: ElevenLabsService,
  ) {}

  async create(
    createOrganizationDto: CreateOrganizationDto,
    userId: string,
  ): Promise<Organization> {
    // 0. Auto-create an ElevenLabs Agent for this organization
    try {
      console.log(
        `[OrganizationsService] Creating ElevenLabs agent for org: ${createOrganizationDto.name}`,
      );
      const agentId = await this.elevenLabsService.createAgent(
        createOrganizationDto.name,
      );
      if (agentId) {
        createOrganizationDto.elevenLabsAgentId = agentId;
        console.log(`[OrganizationsService] Assigned Agent ID: ${agentId}`);
      }
    } catch (e) {
      console.error(
        `[OrganizationsService] Failed to auto-create ElevenLabs Agent: ${e.message}. The Org will be created without a dedicated agent.`,
      );
    }

    // 1. Create the new organization
    const organization = new this.organizationModel(createOrganizationDto);
    const savedOrganization = await organization.save();
    console.log(
      `OrganizationsService.create: savedOrganization ID=${savedOrganization._id}`,
    );

    // 2. Update the existing user record with the new organization ID
    // Instead of creating a new user, we update the existing user to link them to the organization
    console.log(
      `OrganizationsService.create: updating user ${userId} with org ${savedOrganization._id}`,
    );
    // 2. Add the user to the new organization (multi-membership)
    console.log(
      `OrganizationsService.create: adding user ${userId} to org ${savedOrganization._id}`,
    );
    await this.usersService.addOrganizationToUser(
      userId,
      savedOrganization._id.toString(),
    );
    console.log(`OrganizationsService.create: user updated successfully`);

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
  async removeSupportEmail(id: string, email: string): Promise<void> {
    await this.organizationModel.updateOne(
      { _id: id },
      { $pull: { additionalEmails: email } },
    );
  }

  async findByMemberEmail(email: string): Promise<Organization[]> {
    console.log(`OrganizationsService.findByMemberEmail: finding for ${email}`);
    // Find all users with this email to get their organization IDs
    const users = await this.usersService.findAllByEmail(email);
    console.log(
      `OrganizationsService.findByMemberEmail: found ${users.length} user records`,
    );
    const orgIds = new Set<string>();
    users.forEach((u) => {
      if (u.organizationId) {
        orgIds.add(u.organizationId.toString());
      }
      if (u.organizations) {
        u.organizations.forEach((o) => {
          if (o.organizationId) {
            orgIds.add(o.organizationId.toString());
          }
        });
      }
    });

    const uniqueOrgIds = Array.from(orgIds);
    console.log(
      `OrganizationsService.findByMemberEmail: orgIds:`,
      uniqueOrgIds,
    );
    const orgs = await this.organizationModel
      .find({ _id: { $in: uniqueOrgIds } })
      .exec();
    console.log(
      `OrganizationsService.findByMemberEmail: found ${orgs.length} organizations`,
    );
    return orgs;
  }

  isWithinBusinessHours(organization: Organization): {
    isWithin: boolean;
    nextOpeningTime?: DateTime;
  } {
    const { businessHours, timezone = 'UTC' } = organization;
    if (!businessHours || businessHours.length === 0) {
      return { isWithin: true };
    }

    const now = DateTime.now().setZone(timezone);
    const todayName = now.toFormat('EEEE');
    const todaySchedule = businessHours.find((bh) => bh.day === todayName);

    if (todaySchedule && !todaySchedule.closed) {
      const [openHour, openMin] = todaySchedule.open.split(':').map(Number);
      const [closeHour, closeMin] = todaySchedule.close.split(':').map(Number);

      const openTime = now.set({
        hour: openHour,
        minute: openMin,
        second: 0,
        millisecond: 0,
      });
      const closeTime = now.set({
        hour: closeHour,
        minute: closeMin,
        second: 0,
        millisecond: 0,
      });

      if (now >= openTime && now <= closeTime) {
        return { isWithin: true };
      }
    }

    // Find next opening time
    for (let i = 0; i < 8; i++) {
      const nextDay = now.plus({ days: i });
      const nextDayName = nextDay.toFormat('EEEE');
      const nextDaySchedule = businessHours.find(
        (bh) => bh.day === nextDayName,
      );

      if (nextDaySchedule && !nextDaySchedule.closed) {
        const [openHour, openMin] = nextDaySchedule.open.split(':').map(Number);
        const openTime = nextDay.set({
          hour: openHour,
          minute: openMin,
          second: 0,
          millisecond: 0,
        });

        if (openTime > now) {
          return { isWithin: false, nextOpeningTime: openTime };
        }
      }
    }

    return { isWithin: false };
  }
}
