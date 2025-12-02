import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UserRole } from '../users/entities/user.entity';
import { Tag, TagDocument } from '../tags/entities/tag.entity';
import { GroupsService } from '../groups/groups.service';
import { ThreadsService } from '../threads/threads.service';

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket.name)
    private ticketModel: Model<TicketDocument>,
    @InjectModel(Tag.name)
    private tagModel: Model<TagDocument>,
    private groupsService: GroupsService,
    @Inject(forwardRef(() => ThreadsService))
    private threadsService: ThreadsService,
  ) {}

  async create(
    createTicketDto: CreateTicketDto,
    organizationId: string,
  ): Promise<Ticket> {
    const ticketData: any = {
      ...createTicketDto,
      customerId: new Types.ObjectId(createTicketDto.customerId),
      organizationId: new Types.ObjectId(organizationId),
    };

    if (createTicketDto.assignedToId) {
      ticketData.assignedToId = new Types.ObjectId(
        createTicketDto.assignedToId,
      );
    }

    if (createTicketDto.assignedToGroupId) {
      ticketData.assignedToGroupId = new Types.ObjectId(
        createTicketDto.assignedToGroupId,
      );
    }

    if (createTicketDto.categoryId) {
      ticketData.categoryId = new Types.ObjectId(createTicketDto.categoryId);
    }

    if (createTicketDto.tagIds && createTicketDto.tagIds.length > 0) {
      ticketData.tagIds = createTicketDto.tagIds.map(
        (id) => new Types.ObjectId(id),
      );
    }

    const ticket = new this.ticketModel(ticketData);
    const savedTicket = await ticket.save();

    // Auto-create thread for ticket (one thread per ticket)
    // This allows agents to immediately send messages without creating a thread first
    try {
      await this.threadsService.getOrCreateThread(
        savedTicket._id.toString(),
        createTicketDto.customerId,
        organizationId,
      );
    } catch (error) {
      // If thread creation fails, log but don't fail ticket creation
      // This ensures ticket creation is resilient
      console.error('Failed to auto-create thread:', error);
    }

    return savedTicket;
  }

  async findAll(
    userId: string,
    userRole: UserRole,
    organizationId: string,
  ): Promise<Ticket[]> {
    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
    };

    // Agents see tickets assigned to them, their groups, or unassigned tickets
    // Admins see all tickets in org
    if (userRole === UserRole.AGENT) {
      // Get groups the user belongs to
      const userGroups = await this.groupsService.findByMember(
        userId,
        organizationId,
      );
      const groupIds = userGroups.map((group) => group._id);

      query.$or = [
        { assignedToId: new Types.ObjectId(userId) },
        { assignedToGroupId: { $in: groupIds } },
        {
          assignedToId: { $exists: false },
          assignedToGroupId: { $exists: false },
        }, // Unassigned tickets
      ];
    }
    // Admins see all tickets (no additional filter)

    return this.ticketModel
      .find(query)
      .populate('customerId', 'email firstName lastName company')
      .populate('assignedToId', 'email firstName lastName')
      .populate('assignedToGroupId', 'name description')
      .populate('categoryId', 'name description')
      .populate('tagIds', 'name color')
      .exec();
  }

  async findOne(
    id: string,
    userId: string,
    userRole: UserRole,
    organizationId: string,
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel
      .findOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate('customerId', 'email firstName lastName company')
      .populate('assignedToId', 'email firstName lastName')
      .populate('assignedToGroupId', 'name description')
      .populate('categoryId', 'name description')
      .populate('tagIds', 'name color')
      .exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${id} not found`);
    }

    const ticketAssignedToId = ticket.assignedToId?.toString();
    const ticketAssignedToGroupId = ticket.assignedToGroupId?.toString();

    // Agents can see tickets assigned to them or their groups
    if (userRole === UserRole.AGENT) {
      if (ticketAssignedToId === userId) {
        // Assigned directly to user
        return ticket;
      }

      if (ticketAssignedToGroupId) {
        // Check if user is in the assigned group
        const userGroups = await this.groupsService.findByMember(
          userId,
          organizationId,
        );
        const isInGroup = userGroups.some(
          (group) => group._id.toString() === ticketAssignedToGroupId,
        );

        if (isInGroup) {
          return ticket;
        }
      }

      // Not assigned to user or their groups
      throw new ForbiddenException(
        'You do not have permission to view this ticket',
      );
    }

    return ticket;
  }

  async update(
    id: string,
    updateTicketDto: UpdateTicketDto,
    userId: string,
    userRole: UserRole,
    organizationId: string,
  ): Promise<Ticket> {
    const ticket = await this.findOne(id, userId, userRole, organizationId);

    // Only agents and admins can update tickets
    // Customers (external parties) cannot update tickets directly

    const updateData: any = { ...updateTicketDto };

    if (updateTicketDto.assignedToId) {
      updateData.assignedToId = new Types.ObjectId(
        updateTicketDto.assignedToId,
      );
      // Clear group assignment if assigning to individual
      updateData.assignedToGroupId = null;
    }

    if (updateTicketDto.assignedToGroupId) {
      updateData.assignedToGroupId = new Types.ObjectId(
        updateTicketDto.assignedToGroupId,
      );
      // Clear individual assignment if assigning to group
      updateData.assignedToId = null;
    }

    if (updateTicketDto.categoryId) {
      updateData.categoryId = new Types.ObjectId(updateTicketDto.categoryId);
    }

    if (updateTicketDto.tagIds) {
      updateData.tagIds = updateTicketDto.tagIds.map(
        (tagId) => new Types.ObjectId(tagId),
      );
    }

    Object.assign(ticket, updateData);
    return ticket.save();
  }

  async remove(
    id: string,
    userId: string,
    userRole: UserRole,
    organizationId: string,
  ): Promise<void> {
    if (userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete tickets');
    }

    await this.findOne(id, userId, userRole, organizationId);
    await this.ticketModel.findByIdAndDelete(id).exec();
  }
}
