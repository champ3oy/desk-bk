import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UserRole } from '../users/entities/user.entity';
import { Tag, TagDocument } from '../tags/entities/tag.entity';
import { GroupsService } from '../groups/groups.service';
import { ThreadsService } from '../threads/threads.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { draftResponse } from '../ai/agents/response';
import {
  MessageType,
  MessageAuthorType,
} from '../threads/entities/message.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TicketPaginationDto } from './dto/ticket-pagination.dto';

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
    private organizationsService: OrganizationsService,
    private configService: ConfigService,
  ) {}

  /**
   * Check if ticket content matches any restricted topics
   */
  private checkRestrictedTopics(
    subject: string,
    description: string,
    restrictedTopics: string[],
  ): boolean {
    if (!restrictedTopics || restrictedTopics.length === 0) {
      return false;
    }

    const content = `${subject} ${description}`.toLowerCase();

    return restrictedTopics.some((topic) =>
      content.includes(topic.toLowerCase()),
    );
  }

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

    // Enhanced Auto-reply with full configuration support
    try {
      const org = await this.organizationsService.findOne(organizationId);

      // Check if auto-reply is enabled for this channel
      // For now, we assume email channel. In future, check ticket.channel
      const shouldAutoReply = org.aiAutoReplyEmail; // Could be org.aiAutoReplySocialMedia or org.aiAutoReplyLiveChat based on channel

      if (shouldAutoReply) {
        // Check restricted topics
        const isRestricted = this.checkRestrictedTopics(
          savedTicket.subject,
          savedTicket.description,
          org.aiRestrictedTopics || [],
        );

        if (isRestricted) {
          console.log(
            `Skipping auto-reply for ticket ${savedTicket._id}: matches restricted topic`,
          );
          return savedTicket;
        }

        // Use timeout to not block the main request
        setTimeout(async () => {
          try {
            const response = await draftResponse(
              savedTicket._id.toString(),
              this,
              this.threadsService,
              this.configService,
              this.organizationsService,
              null, // knowledgeBaseService - not injected in tickets service yet
              createTicketDto.customerId, // Use customer ID for context permissions
              UserRole.CUSTOMER, // Assume customer role for the context
              organizationId,
            );

            if (response.content) {
              // Check confidence threshold (if available in response metadata)
              // For now, we'll assume the AI is confident enough
              // In future, implement confidence scoring
              const confidence = 85; // Placeholder - should come from AI response

              if (confidence >= (org.aiConfidenceThreshold || 85)) {
                const thread = await this.threadsService.getOrCreateThread(
                  savedTicket._id.toString(),
                  createTicketDto.customerId,
                  organizationId,
                );

                await this.threadsService.createMessage(
                  thread._id.toString(),
                  {
                    content: response.content,
                    messageType: MessageType.EXTERNAL,
                  },
                  organizationId,
                  createTicketDto.customerId,
                  UserRole.CUSTOMER,
                  MessageAuthorType.AI,
                );

                console.log(
                  `AI auto-reply sent for ticket ${savedTicket._id} (confidence: ${confidence}%)`,
                );
              } else {
                console.log(
                  `Skipping auto-reply for ticket ${savedTicket._id}: confidence ${confidence}% below threshold ${org.aiConfidenceThreshold}%`,
                );
              }
            }
          } catch (err) {
            console.error('Failed to generate AI auto-reply:', err);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to check auto-reply settings:', error);
    }

    return savedTicket;
  }

  async findAll(
    userId: string,
    userRole: UserRole,
    organizationId: string,
    paginationDto: TicketPaginationDto = { page: 1, limit: 10 },
  ): Promise<{
    data: Ticket[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    console.log(
      `FindAll Tickets: User=${userId}, Role=${userRole}, Org=${organizationId}`,
    );
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      assignedToId: filterAssignedToId,
      customerId,
    } = paginationDto;
    const skip = (page - 1) * limit;

    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
    };

    // Apply filters
    if (status) {
      query.status = status;
    }
    if (priority) {
      query.priority = priority;
    }
    if (filterAssignedToId) {
      query.assignedToId = new Types.ObjectId(filterAssignedToId);
    }
    if (customerId) {
      query.customerId = new Types.ObjectId(customerId);
    }

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
        {
          _id: {
            $in: await this.threadsService.findTicketIdsByParticipant(
              userId,
              organizationId,
            ),
          },
        },
      ];
    }
    // Admins see all tickets (no additional filter)

    const [data, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'email firstName lastName company')
        .populate('organizationId', 'name')
        .populate('assignedToId', 'email firstName lastName')
        .populate('assignedToGroupId', 'name description')
        .populate('categoryId', 'name description')
        .populate('tagIds', 'name color')
        .exec(),
      this.ticketModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
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
      .populate('organizationId', 'name')
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

    // Customers can only see their own tickets
    if (userRole === UserRole.CUSTOMER) {
      const ticketCustomerId =
        typeof ticket.customerId === 'object' && ticket.customerId
          ? (ticket.customerId as any)._id.toString()
          : String(ticket.customerId);

      if (ticketCustomerId !== userId) {
        throw new ForbiddenException(
          'You do not have permission to view this ticket',
        );
      }
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
    // Verify existence and permissions first
    const existingTicket = await this.findOne(
      id,
      userId,
      userRole,
      organizationId,
    );

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

    // Use findByIdAndUpdate to avoid validation errors on existing valid/invalid documents involved in full save()
    // and to handle atomic updates better.
    const updatedTicket = await this.ticketModel
      .findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: false }, // Disable validators to allow updates on legacy docs that might miss fields
      )
      .populate('customerId', 'email firstName lastName company')
      .populate('organizationId', 'name')
      .populate('assignedToId', 'email firstName lastName')
      .populate('assignedToGroupId', 'name description')
      .populate('categoryId', 'name description')
      .populate('tagIds', 'name color')
      .exec();

    if (!updatedTicket) {
      throw new NotFoundException(`Ticket with ID ${id} not found`);
    }

    return updatedTicket;
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
