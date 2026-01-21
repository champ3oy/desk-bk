import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from './entities/group.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { RemoveMembersDto } from './dto/remove-members.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
    private usersService: UsersService,
  ) {}

  async create(
    createGroupDto: CreateGroupDto,
    organizationId: string,
  ): Promise<GroupDocument> {
    // Check for duplicate name in organization
    const existingGroup = await this.groupModel.findOne({
      name: createGroupDto.name,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (existingGroup) {
      throw new ConflictException(
        'Group with this name already exists in this organization',
      );
    }

    // Validate member IDs if provided
    if (createGroupDto.memberIds && createGroupDto.memberIds.length > 0) {
      await this.validateMembers(createGroupDto.memberIds, organizationId);
    }

    const group = new this.groupModel({
      ...createGroupDto,
      organizationId: new Types.ObjectId(organizationId),
      memberIds: createGroupDto.memberIds
        ? createGroupDto.memberIds.map((id) => new Types.ObjectId(id))
        : [],
    });

    return group.save();
  }

  async findAll(organizationId: string): Promise<GroupDocument[]> {
    return this.groupModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .populate('memberIds', 'email firstName lastName role')
      .exec();
  }

  async findOne(id: string, organizationId: string): Promise<GroupDocument> {
    const group = await this.groupModel
      .findOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate('memberIds', 'email firstName lastName role')
      .exec();

    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }

    return group;
  }

  async update(
    id: string,
    updateGroupDto: UpdateGroupDto,
    organizationId: string,
  ): Promise<GroupDocument> {
    const group = await this.findOne(id, organizationId);

    // Check for duplicate name if name is being updated
    if (updateGroupDto.name && updateGroupDto.name !== group.name) {
      const existingGroup = await this.groupModel.findOne({
        name: updateGroupDto.name,
        organizationId: new Types.ObjectId(organizationId),
        _id: { $ne: id },
      });

      if (existingGroup) {
        throw new ConflictException(
          'Group with this name already exists in this organization',
        );
      }
    }

    Object.assign(group, updateGroupDto);
    return group.save();
  }

  async addMembers(
    id: string,
    addMembersDto: AddMembersDto,
    organizationId: string,
  ): Promise<GroupDocument> {
    const group = await this.findOne(id, organizationId);

    // Validate members
    await this.validateMembers(addMembersDto.memberIds, organizationId);

    // Add members (avoid duplicates)
    const existingMemberIds = group.memberIds.map((id) => id.toString());
    const newMemberIds = addMembersDto.memberIds.filter(
      (id) => !existingMemberIds.includes(id),
    );

    if (newMemberIds.length === 0) {
      throw new BadRequestException('All specified users are already members');
    }

    group.memberIds.push(...newMemberIds.map((id) => new Types.ObjectId(id)));

    return group.save();
  }

  async removeMembers(
    id: string,
    removeMembersDto: RemoveMembersDto,
    organizationId: string,
  ): Promise<GroupDocument> {
    const group = await this.findOne(id, organizationId);

    const memberIdsToRemove = removeMembersDto.memberIds.map(
      (id) => new Types.ObjectId(id),
    );

    group.memberIds = group.memberIds.filter(
      (memberId) => !memberIdsToRemove.some((id) => id.equals(memberId)),
    );

    return group.save();
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.groupModel
      .findOneAndDelete({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findByMember(
    userId: string,
    organizationId: string,
  ): Promise<GroupDocument[]> {
    return this.groupModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        memberIds: new Types.ObjectId(userId),
        isActive: true,
      })
      .populate('memberIds', 'email firstName lastName role')
      .exec();
  }

  private async validateMembers(
    memberIds: string[],
    organizationId: string,
  ): Promise<void> {
    for (const memberId of memberIds) {
      const user = await this.usersService.findOne(memberId, organizationId);
      // Users must be agents or admins to be in groups
      if (
        user.role !== 'agent' &&
        user.role !== 'admin' &&
        user.role !== 'light_agent'
      ) {
        throw new BadRequestException(
          `User ${user.email} must be an agent, light agent, or admin to be added to a group`,
        );
      }
    }
  }
}
