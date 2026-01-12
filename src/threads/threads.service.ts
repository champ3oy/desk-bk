import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Thread, ThreadDocument } from './entities/thread.entity';
import {
  Message,
  MessageDocument,
  MessageAuthorType,
  MessageType,
  MessageChannel,
} from './entities/message.entity';
import { CreateThreadDto } from './dto/create-thread.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { TicketsService } from '../tickets/tickets.service';
import { CustomersService } from '../customers/customers.service';
import { GroupsService } from '../groups/groups.service';
import { UserRole } from '../users/entities/user.entity';
import { DispatcherService } from '../dispatcher/dispatcher.service';

@Injectable()
export class ThreadsService {
  constructor(
    @InjectModel(Thread.name)
    private threadModel: Model<ThreadDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @Inject(forwardRef(() => TicketsService))
    private ticketsService: TicketsService,
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    private groupsService: GroupsService,
    private dispatcherService: DispatcherService,
  ) {}

  /**
   * Get or create the single thread for a ticket.
   * Each ticket has exactly one thread.
   */
  async getOrCreateThread(
    ticketId: string,
    customerId: string,
    organizationId: string,
    metadata?: Record<string, any>,
  ): Promise<ThreadDocument> {
    // Check if thread already exists for this ticket
    const existingThread = await this.threadModel.findOne({
      ticketId: new Types.ObjectId(ticketId),
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    });

    if (existingThread) {
      if (metadata) {
        // Merge new metadata if provided
        existingThread.metadata = { ...existingThread.metadata, ...metadata };
        await existingThread.save();
      }
      return existingThread;
    }

    // Verify customer exists
    await this.customersService.findOne(customerId, organizationId);

    // Create new thread (one per ticket)
    const thread = new this.threadModel({
      ticketId: new Types.ObjectId(ticketId),
      customerId: new Types.ObjectId(customerId),
      organizationId: new Types.ObjectId(organizationId),
      participantUserIds: [],
      participantGroupIds: [],
      isActive: true,
      metadata: metadata || {},
    });

    return thread.save();
  }

  /**
   * Get the thread for a ticket (there should be exactly one)
   */
  async findByTicket(
    ticketId: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ThreadDocument | null> {
    // Verify ticket access
    await this.ticketsService.findOne(
      ticketId,
      userId,
      userRole,
      organizationId,
    );

    const thread = await this.threadModel
      .findOne({
        ticketId: new Types.ObjectId(ticketId),
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
      })
      .populate('customerId', 'email firstName lastName company')
      .populate('participantUserIds', 'email firstName lastName role')
      .populate('participantGroupIds', 'name description')
      .exec();

    return thread;
  }

  async findOne(
    id: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ThreadDocument> {
    const thread = await this.threadModel
      .findOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate('customerId', 'email firstName lastName company')
      .populate('participantUserIds', 'email firstName lastName role')
      .populate('participantGroupIds', 'name description')
      .exec();

    if (!thread) {
      throw new NotFoundException(`Thread with ID ${id} not found`);
    }

    // Verify user has access to the ticket
    await this.ticketsService.findOne(
      thread.ticketId.toString(),
      userId,
      userRole,
      organizationId,
    );

    return thread;
  }

  async createMessage(
    threadId: string,
    createMessageDto: CreateMessageDto,
    organizationId: string,
    userId: string,
    userRole: UserRole,
    authorType: MessageAuthorType = MessageAuthorType.USER,
  ): Promise<MessageDocument> {
    let thread;
    if (authorType === MessageAuthorType.AI) {
      // Bypass permission checks for AI messages
      thread = await this.threadModel
        .findOne({
          _id: threadId,
          organizationId: new Types.ObjectId(organizationId),
        })
        .exec();

      if (!thread) {
        throw new NotFoundException(`Thread with ID ${threadId} not found`);
      }
    } else {
      thread = await this.findOne(threadId, organizationId, userId, userRole);
    }

    const message = new this.messageModel({
      threadId: new Types.ObjectId(threadId),
      organizationId: new Types.ObjectId(organizationId),
      messageType: createMessageDto.messageType,
      authorType,
      authorId: new Types.ObjectId(userId),
      content: createMessageDto.content,
      channel: createMessageDto.channel || MessageChannel.PLATFORM,
      readBy: [],
      isRead: false,
    });

    const savedMessage = await message.save();

    // Dispatch external messages to customers (e.g. via Email)
    if (
      savedMessage.messageType === MessageType.EXTERNAL &&
      (savedMessage.authorType === MessageAuthorType.USER ||
        savedMessage.authorType === MessageAuthorType.AI)
    ) {
      try {
        // Fetch ticket to get subject
        const ticket = await this.ticketsService.findOne(
          thread.ticketId.toString(),
          userId,
          userRole,
          organizationId,
        );

        // Fetch customer to get email
        // Handle both populated and non-populated customerId
        const customerIdString =
          typeof thread.customerId === 'object' && thread.customerId._id
            ? thread.customerId._id.toString()
            : thread.customerId.toString();

        const customer = await this.customersService.findOne(
          customerIdString,
          organizationId,
        );

        if (customer.email) {
          // Find last message with external ID for threading
          const lastMessage = await this.messageModel
            .findOne({
              threadId: savedMessage.threadId,
              externalMessageId: { $exists: true, $ne: null },
              _id: { $ne: savedMessage._id }, // Exclude current message
            })
            .sort({ createdAt: -1 });

          await this.dispatcherService.dispatch(
            savedMessage,
            ticket,
            customer.email,
            lastMessage?.externalMessageId,
            lastMessage?.externalMessageId, // Simple threading: use last ID as references too
          );
        }
      } catch (error) {
        console.error('Failed to dispatch message:', error);
        // Don't fail the request, just log
      }
    }

    return savedMessage;
  }

  async getMessages(
    threadId: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
    messageType?: MessageType,
  ): Promise<MessageDocument[]> {
    const thread = await this.findOne(
      threadId,
      organizationId,
      userId,
      userRole,
    );

    const query: any = {
      threadId: new Types.ObjectId(threadId),
      organizationId: new Types.ObjectId(organizationId),
    };

    // Filter by message type if provided
    if (messageType) {
      query.messageType = messageType;
    } else {
      // If no filter specified, show all messages user can see
      // For customers, only show external messages
      // For agents/admins, show all messages if they're participants or admins
      if (userRole === UserRole.ADMIN) {
        // Admins see all messages
      } else {
        // Check if user is a participant (can see internal messages)
        const isParticipant = thread.participantUserIds.some(
          (id) => id.toString() === userId,
        );

        if (!isParticipant) {
          // Check if user is in any participant group
          const userGroups = await this.groupsService.findByMember(
            userId,
            organizationId,
          );
          const isInGroup = thread.participantGroupIds.some((groupId) =>
            userGroups.some(
              (group) => group._id.toString() === groupId.toString(),
            ),
          );

          if (!isInGroup) {
            // User is not a participant, only show external messages
            query.messageType = MessageType.EXTERNAL;
          }
        }
      }
    }

    return this.messageModel
      .find(query)
      .populate('authorId')
      .sort({ createdAt: 1 })
      .exec();
  }

  async markAsRead(
    messageId: string,
    organizationId: string,
    userId: string,
  ): Promise<MessageDocument> {
    const message = await this.messageModel
      .findOne({
        _id: messageId,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();

    if (!message) {
      throw new NotFoundException(`Message with ID ${messageId} not found`);
    }

    const userIdObj = new Types.ObjectId(userId);
    if (!message.readBy.some((id) => id.equals(userIdObj))) {
      message.readBy.push(userIdObj);
      message.isRead = message.readBy.length > 0;
      await message.save();
    }

    return message;
  }

  async remove(threadId: string, organizationId: string): Promise<void> {
    const thread = await this.threadModel
      .findOne({
        _id: threadId,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();

    if (!thread) {
      throw new NotFoundException(`Thread with ID ${threadId} not found`);
    }

    thread.isActive = false;
    await thread.save();
  }

  /**
   * Add participants (users or groups) to a thread.
   * This allows more users to see internal messages.
   */
  async addParticipants(
    threadId: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
    participantUserIds?: string[],
    participantGroupIds?: string[],
  ): Promise<ThreadDocument> {
    const thread = await this.findOne(
      threadId,
      organizationId,
      userId,
      userRole,
    );

    if (
      (!participantUserIds || participantUserIds.length === 0) &&
      (!participantGroupIds || participantGroupIds.length === 0)
    ) {
      throw new BadRequestException(
        'At least one participant (user or group) is required',
      );
    }

    // Verify groups exist
    if (participantGroupIds && participantGroupIds.length > 0) {
      for (const groupId of participantGroupIds) {
        await this.groupsService.findOne(groupId, organizationId);
      }
    }

    // Add new user participants (avoid duplicates)
    if (participantUserIds && participantUserIds.length > 0) {
      const existingUserIds = thread.participantUserIds.map((id) =>
        id.toString(),
      );
      const newUserIds = participantUserIds.filter(
        (id) => !existingUserIds.includes(id),
      );
      thread.participantUserIds.push(
        ...newUserIds.map((id) => new Types.ObjectId(id)),
      );
    }

    // Add new group participants (avoid duplicates)
    if (participantGroupIds && participantGroupIds.length > 0) {
      const existingGroupIds = thread.participantGroupIds.map((id) =>
        id.toString(),
      );
      const newGroupIds = participantGroupIds.filter(
        (id) => !existingGroupIds.includes(id),
      );
      thread.participantGroupIds.push(
        ...newGroupIds.map((id) => new Types.ObjectId(id)),
      );
    }

    return thread.save();
  }

  /**
   * Remove participants from a thread.
   */
  async removeParticipants(
    threadId: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
    participantUserIds?: string[],
    participantGroupIds?: string[],
  ): Promise<ThreadDocument> {
    const thread = await this.findOne(
      threadId,
      organizationId,
      userId,
      userRole,
    );

    // Remove user participants
    if (participantUserIds && participantUserIds.length > 0) {
      thread.participantUserIds = thread.participantUserIds.filter(
        (id) => !participantUserIds.includes(id.toString()),
      );
    }

    // Remove group participants
    if (participantGroupIds && participantGroupIds.length > 0) {
      thread.participantGroupIds = thread.participantGroupIds.filter(
        (id) => !participantGroupIds.includes(id.toString()),
      );
    }

    return thread.save();
  }

  /**
   * Create or get the thread for a ticket.
   * Note: Threads are usually auto-created when tickets are created.
   * This endpoint is mainly for edge cases where a thread needs to be manually created.
   */
  async create(
    createThreadDto: CreateThreadDto,
    organizationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ThreadDocument> {
    // Verify ticket exists and user has access
    await this.ticketsService.findOne(
      createThreadDto.ticketId,
      userId,
      userRole,
      organizationId,
    );

    if (!createThreadDto.customerId) {
      throw new BadRequestException('Customer ID is required');
    }

    // Use getOrCreateThread to ensure one thread per ticket
    return this.getOrCreateThread(
      createThreadDto.ticketId,
      createThreadDto.customerId,
      organizationId,
    );
  }

  /**
   * Get all threads for a ticket (legacy method for backward compatibility).
   * Since each ticket has exactly one thread, this returns an array with 0 or 1 thread.
   * @deprecated Use findByTicket instead, which returns a single thread or null.
   */
  async findAll(
    ticketId: string,
    organizationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ThreadDocument[]> {
    // Return single thread for ticket (or empty array if none exists)
    const thread = await this.findByTicket(
      ticketId,
      organizationId,
      userId,
      userRole,
    );
    return thread ? [thread] : [];
  }
  async findTicketIdsByParticipant(
    userId: string,
    organizationId: string,
  ): Promise<Types.ObjectId[]> {
    const threads = await this.threadModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        participantUserIds: new Types.ObjectId(userId),
        isActive: true,
      })
      .select('ticketId')
      .exec();

    return threads.map((t) => t.ticketId);
  }

  /**
   * Merge two threads.
   * Moves all messages from source thread to target thread.
   * Merges participants.
   * Deactivates source thread.
   */
  async mergeThreads(
    sourceThreadId: string,
    targetThreadId: string,
    organizationId: string,
  ): Promise<void> {
    const sourceThread = await this.threadModel.findOne({
      _id: sourceThreadId,
      organizationId: new Types.ObjectId(organizationId),
    });

    const targetThread = await this.threadModel.findOne({
      _id: targetThreadId,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!sourceThread || !targetThread) {
      throw new NotFoundException('One or both threads not found');
    }

    // Move messages
    await this.messageModel.updateMany(
      { threadId: sourceThreadId },
      { $set: { threadId: targetThreadId } },
    );

    // Merge participants
    const userParticipants = new Set([
      ...sourceThread.participantUserIds.map((id) => id.toString()),
      ...targetThread.participantUserIds.map((id) => id.toString()),
    ]);

    const groupParticipants = new Set([
      ...sourceThread.participantGroupIds.map((id) => id.toString()),
      ...targetThread.participantGroupIds.map((id) => id.toString()),
    ]);

    targetThread.participantUserIds = Array.from(userParticipants).map(
      (id) => new Types.ObjectId(id),
    );
    targetThread.participantGroupIds = Array.from(groupParticipants).map(
      (id) => new Types.ObjectId(id),
    );

    await targetThread.save();

    // Deactivate source thread
    sourceThread.isActive = false;
    await sourceThread.save();
  }

  /**
   * Update customer references in threads and messages.
   * Used when merging customers.
   */
  async updateCustomerForThreads(
    oldCustomerId: string,
    newCustomerId: string,
    organizationId: string,
  ): Promise<void> {
    // Update threads
    await this.threadModel.updateMany(
      {
        customerId: new Types.ObjectId(oldCustomerId),
        organizationId: new Types.ObjectId(organizationId),
      },
      {
        $set: { customerId: new Types.ObjectId(newCustomerId) },
      },
    );

    // Update messages (where author is the customer)
    // Note: We should strictly check authorType, but filtering by ID is usually safe enough if IDs are unique across collections
    // But let's be safe and check authorType if possible. The schema has authorType.
    await this.messageModel.updateMany(
      {
        authorId: new Types.ObjectId(oldCustomerId),
        organizationId: new Types.ObjectId(organizationId),
        authorType: MessageAuthorType.CUSTOMER, // Assuming this enum value exists and is correct context
      },
      {
        $set: { authorId: new Types.ObjectId(newCustomerId) },
      },
    );
  }
}
