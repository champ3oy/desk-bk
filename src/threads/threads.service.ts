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
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { WidgetGateway } from '../gateways/widget.gateway';

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

    private notificationsService: NotificationsService,
    private widgetGateway: WidgetGateway,
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
      attachments: createMessageDto.attachments || [],
      readBy: [],
      isRead: false,
    });

    const savedMessage = await message.save();

    // Update ticket's firstResponseAt if this is the first external response from agent/AI
    if (
      savedMessage.messageType === MessageType.EXTERNAL &&
      (savedMessage.authorType === MessageAuthorType.USER ||
        savedMessage.authorType === MessageAuthorType.AI)
    ) {
      // Use a background update to avoid blocking
      this.ticketsService
        .findOne(
          thread.ticketId.toString(),
          organizationId, // use orgId as userId for admin access
          UserRole.ADMIN,
          organizationId,
        )
        .then(async (ticket) => {
          if (ticket && !ticket.firstResponseAt) {
            await this.ticketsService.update(
              ticket._id.toString(),
              { firstResponseAt: new Date() } as any,
              organizationId,
              UserRole.ADMIN,
              organizationId,
            );
          }
        })
        .catch((err) =>
          console.error(
            `Failed to update firstResponseAt for ticket ${thread.ticketId}`,
            err,
          ),
        );
    }

    // Notify Widget via WebSocket if applicable
    if (thread.metadata?.sessionId) {
      // Populate author for the socket event
      await savedMessage.populate({
        path: 'authorId',
        select: 'firstName lastName email',
      });
      this.widgetGateway.sendNewMessage(
        organizationId,
        thread.metadata.sessionId,
        savedMessage,
      );
    }

    // Auto-reply Logic for existing threads (Customer messages)
    if (
      savedMessage.messageType === MessageType.EXTERNAL &&
      savedMessage.authorType === MessageAuthorType.USER &&
      savedMessage.channel !== MessageChannel.EMAIL // Avoid double-replying if email dispatcher handles it (though email dispatcher is usually outbound)
    ) {
      if (userRole === UserRole.CUSTOMER) {
        // Trigger AI check
        // We shouldn't await this to keep the API fast
        this.findOne(threadId, organizationId, userId, userRole)
          .then((thread) => {
            if (thread && thread.ticketId) {
              this.ticketsService
                .handleAutoReply(
                  thread.ticketId.toString(),
                  createMessageDto.content,
                  organizationId,
                  userId,
                  savedMessage.channel || 'chat',
                )
                .catch((e) =>
                  console.error(
                    `[AutoReply] Failed for message ${savedMessage._id}`,
                    e,
                  ),
                );
            }
          })
          .catch((e) =>
            console.error('Failed to fetch thread for auto-reply', e),
          );
      } else {
        // Agent replied - Check if we need to de-escalate and auto-assign
        // This runs for agents/admins
        this.findOne(threadId, organizationId, userId, userRole).then(
          async (thread) => {
            if (thread && thread.ticketId) {
              // De-escalate the ticket
              await this.ticketsService.deEscalateTicket(
                thread.ticketId.toString(),
              );

              // Auto-assign ticket to the replying agent if not already assigned
              // Also disable AI auto-reply if ticket was escalated
              try {
                const ticket = await this.ticketsService.findOne(
                  thread.ticketId.toString(),
                  userId,
                  userRole,
                  organizationId,
                );

                const updateData: any = {};
                let shouldUpdate = false;

                // Auto-assign if not already assigned to a specific user
                if (!ticket.assignedToId) {
                  updateData.assignedToId = userId;
                  shouldUpdate = true;
                  console.log(
                    `[Auto-Assign] Ticket ${thread.ticketId} assigned to agent ${userId}`,
                  );
                }

                // Disable AI auto-reply if ticket was escalated
                if (
                  (ticket.isAiEscalated || ticket.status === 'escalated') &&
                  !ticket.aiAutoReplyDisabled
                ) {
                  updateData.aiAutoReplyDisabled = true;
                  shouldUpdate = true;
                  console.log(
                    `[Auto-Assign] AI auto-reply disabled for escalated ticket ${thread.ticketId}`,
                  );
                }

                if (shouldUpdate) {
                  await this.ticketsService.update(
                    thread.ticketId.toString(),
                    updateData,
                    userId,
                    userRole,
                    organizationId,
                  );
                }
              } catch (error) {
                console.error(
                  `[Auto-Assign] Failed to auto-assign ticket ${thread.ticketId}:`,
                  error,
                );
              }
            }
          },
        );
      }
    }

    // Dispatch external messages to customers (e.g. via Email)
    if (
      savedMessage.messageType === MessageType.EXTERNAL &&
      (savedMessage.authorType === MessageAuthorType.USER ||
        savedMessage.authorType === MessageAuthorType.AI) &&
      savedMessage.channel !== MessageChannel.WIDGET &&
      !(
        savedMessage.channel === MessageChannel.PLATFORM &&
        thread.metadata?.sessionId
      )
    ) {
      try {
        console.log(
          `[ThreadsService] Attempting dispatch for message ${savedMessage._id}. Channel: ${savedMessage.channel}`,
        );
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

        // Dispatch based on channel: email needs email, WhatsApp needs phone
        const shouldDispatch =
          customer.email ||
          (savedMessage.channel === MessageChannel.WHATSAPP && customer.phone);

        console.log(
          `[ThreadsService] Dispatch Check: CustomerEmail=${!!customer.email}, CustomerPhone=${!!customer.phone}, Channel=${savedMessage.channel}, ShouldDispatch=${!!shouldDispatch}`,
        );

        if (shouldDispatch) {
          // Find last message with external ID for threading
          const lastMessage = await this.messageModel
            .findOne({
              threadId: savedMessage.threadId,
              externalMessageId: { $exists: true, $ne: null },
              _id: { $ne: savedMessage._id }, // Exclude current message
            })
            .sort({ createdAt: -1 });

          console.log(`[ThreadsService] Calling dispatcherService.dispatch...`);
          await this.dispatcherService.dispatch(
            savedMessage,
            ticket,
            (customer.email || customer.phone)!, // Use email or phone as recipient identifier
            lastMessage?.externalMessageId,
            lastMessage?.externalMessageId, // Simple threading: use last ID as references too
          );
        } else {
          console.warn(
            `Cannot dispatch message ${savedMessage._id}: Customer has no email${savedMessage.channel === MessageChannel.WHATSAPP ? ' or phone' : ''}`,
          );
        }
      } catch (error) {
        console.error('Failed to dispatch message:', error);
        // Don't fail the request, just log
      }
    } else {
      console.log(
        `[ThreadsService] Skipping dispatch. Type=${savedMessage.messageType}, Author=${savedMessage.authorType}, Channel=${savedMessage.channel}`,
      );
    }

    // Notifications logic
    try {
      if (
        savedMessage.messageType === MessageType.EXTERNAL &&
        savedMessage.authorType === MessageAuthorType.CUSTOMER
      ) {
        // Customer replied -> Notify assigned agent or followers
        const ticket = await this.ticketsService.findOne(
          thread.ticketId.toString(),
          userId, // userId might be customer's ID here, permissions checked in ticketsService
          userRole,
          organizationId,
        );

        if (ticket) {
          const recipients = new Set<string>();
          if (ticket.assignedToId) {
            const assignedToId = ticket.assignedToId as any;
            recipients.add(
              assignedToId._id
                ? assignedToId._id.toString()
                : assignedToId.toString(),
            );
          }
          if (ticket.followers && ticket.followers.length > 0) {
            ticket.followers.forEach((f: any) =>
              recipients.add(f._id ? f._id.toString() : f.toString()),
            );
          }

          // Create notifications
          const promises = Array.from(recipients).map((recipientId) =>
            this.notificationsService.create({
              userId: recipientId,
              type: NotificationType.REPLY,
              title: `New Reply on Ticket #${ticket._id}`,
              body: `${createMessageDto.content.substring(0, 50)}${
                createMessageDto.content.length > 50 ? '...' : ''
              }`,
              metadata: { ticketId: ticket._id.toString() },
            }),
          );
          await Promise.all(promises);
        }
      } else if (
        savedMessage.messageType === MessageType.INTERNAL &&
        createMessageDto.content.includes('@')
      ) {
        // Internal message with potential mention
        // Simple regex for @mentions - assumes format @Name or similar.
        // For distinct user matching, we'd need more logic, but let's notify thread participants who are mentioned.
        // For now, let's just notify all OTHER participants if it's an internal note (simplified "notify all" for collaboration)
        // OR better: Just notify assignees/followers who are NOT the author.

        const ticket = await this.ticketsService.findOne(
          thread.ticketId.toString(),
          userId,
          userRole,
          organizationId,
        );

        if (ticket) {
          const recipients = new Set<string>();
          if (ticket.assignedToId) {
            const assignedToId = ticket.assignedToId as any;
            recipients.add(
              assignedToId._id
                ? assignedToId._id.toString()
                : assignedToId.toString(),
            );
          }
          if (ticket.followers) {
            ticket.followers.forEach((f: any) =>
              recipients.add(f._id ? f._id.toString() : f.toString()),
            );
          }

          // Remove author from recipients
          recipients.delete(userId);

          const promises = Array.from(recipients).map((recipientId) =>
            this.notificationsService.create({
              userId: recipientId,
              type: NotificationType.MENTION,
              title: `New Internal Note on Ticket #${ticket._id}`,
              body: `${createMessageDto.content.substring(0, 50)}${
                createMessageDto.content.length > 50 ? '...' : ''
              }`,
              metadata: { ticketId: ticket._id.toString() },
            }),
          );
          await Promise.all(promises);
        }
      }
    } catch (error) {
      console.error('Failed to create notifications for message:', error);
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

    const ticket = await this.ticketsService.findOne(
      thread.ticketId.toString(),
      userId,
      userRole,
      organizationId,
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
          // Check if user is the assignee
          const assignedToId = ticket.assignedToId
            ? (ticket.assignedToId as any)._id
              ? (ticket.assignedToId as any)._id.toString()
              : ticket.assignedToId.toString()
            : null;

          if (assignedToId === userId) {
            // User is the assignee, full access granted
          } else {
            // Check groups (assigned group or participant group)
            const userGroups = await this.groupsService.findByMember(
              userId,
              organizationId,
            );

            const assignedToGroupId = ticket.assignedToGroupId
              ? (ticket.assignedToGroupId as any)._id
                ? (ticket.assignedToGroupId as any)._id.toString()
                : ticket.assignedToGroupId.toString()
              : null;

            const isAssignedGroup =
              assignedToGroupId &&
              userGroups.some((g) => g._id.toString() === assignedToGroupId);

            const isInParticipantGroup = thread.participantGroupIds.some(
              (groupId) =>
                userGroups.some(
                  (group) => group._id.toString() === groupId.toString(),
                ),
            );

            if (!isAssignedGroup && !isInParticipantGroup) {
              // User is not a participant, assignee, or in any relevant group
              // Show external messages OR internal messages authored by this user
              query.$or = [
                { messageType: MessageType.EXTERNAL },
                {
                  messageType: MessageType.INTERNAL,
                  authorId: new Types.ObjectId(userId),
                },
              ];
            }
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
    const updateResult = await this.messageModel.updateMany(
      { threadId: new Types.ObjectId(sourceThreadId) },
      { $set: { threadId: new Types.ObjectId(targetThreadId) } },
    );
    console.log(
      `Merged ${updateResult.modifiedCount} messages from thread ${sourceThreadId} to ${targetThreadId}`,
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
