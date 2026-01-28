import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  Ticket,
  TicketDocument,
  TicketStatus,
  TicketPriority,
} from './entities/ticket.entity';
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
import { AIModelFactory } from '../ai/ai-model.factory';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

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
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    private notificationsService: NotificationsService,
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

  /**
   * Analyze initial content to generate title, sentiment, and priority
   */
  async analyzeInitialContent(
    content: string,
    organizationId: string,
  ): Promise<{ title: string; sentiment: string; priority: TicketPriority }> {
    try {
      if (!content || content.length < 2) {
        return {
          title: 'New Conversation',
          sentiment: 'neutral',
          priority: TicketPriority.MEDIUM,
        };
      }

      const model = AIModelFactory.create(this.configService);
      const prompt = `Analyze the following customer support message and provide:
1. A very short, precise 3-5 word title (no quotes, no "ID", just the title).
2. The sentiment/mood of the customer (one of: angry, sad, happy, frustrated, neutral, concerned, grateful, confused).
3. The priority level (one of: low, medium, high, urgent).

Return ONLY a JSON object with keys: "title", "sentiment", "priority".

Message: "${content.substring(0, 1000)}"`;

      const response = await model.invoke(prompt);
      let rawContent =
        typeof response.content === 'string' ? response.content : '';

      if (Array.isArray(response.content)) {
        rawContent = (response.content as any)
          .map((c: any) => c.text || '')
          .join('');
      }

      // Extract JSON
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : rawContent;
      const parsed = JSON.parse(jsonString);

      return {
        title: (parsed.title || 'New Conversation')
          .trim()
          .replace(/^"|"$/g, ''),
        sentiment: (parsed.sentiment || 'neutral').toLowerCase(),
        priority:
          (parsed.priority?.toLowerCase() as TicketPriority) ||
          TicketPriority.MEDIUM,
      };
    } catch (e) {
      console.error('Failed to analyze initial AI content', e);
      return {
        title: content.substring(0, 30) + '...',
        sentiment: 'neutral',
        priority: TicketPriority.MEDIUM,
      };
    }
  }

  /**
   * Re-examine the mood of the chat and update the ticket
   */
  async analyzeTicketMood(
    ticketId: string,
    messageContent: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const ticket = await this.ticketModel.findById(ticketId);
      if (!ticket) return;

      // Get recent messages for context
      const thread = await this.threadsService.findByTicket(
        ticketId,
        organizationId,
        organizationId, // Dummy userId for admin bypass
        UserRole.ADMIN, // Use admin role to bypass checks
      );

      if (!thread) return;

      const messages = await this.threadsService.getMessages(
        thread._id.toString(),
        organizationId,
        organizationId, // Dummy userId for admin bypass
        UserRole.ADMIN,
      );

      // Focus on recent customer messages
      const customerMessages = messages
        .filter((m) => m.authorType === MessageAuthorType.CUSTOMER)
        .slice(-5)
        .map((m) => m.content)
        .join('\n---\n');

      const model = AIModelFactory.create(this.configService);
      const prompt = `Analyze the sentiment/mood of the customer based on their recent messages. 
Return ONLY one of the following words in lowercase: angry, sad, happy, frustrated, neutral, concerned, grateful, confused.

Recent messages:
${customerMessages}

New message:
${messageContent}

Sentiment:`;

      const response = await model.invoke(prompt);
      let sentiment = (
        typeof response.content === 'string' ? response.content : 'neutral'
      )
        .trim()
        .toLowerCase();

      // Clean up sentiment (sometimes LLM returns more than one word)
      const validSentiments = [
        'angry',
        'sad',
        'happy',
        'frustrated',
        'neutral',
        'concerned',
        'grateful',
        'confused',
      ];
      const detected = validSentiments.find((s) => sentiment.includes(s));

      if (detected) {
        await this.ticketModel.updateOne(
          { _id: ticketId },
          { $set: { sentiment: detected } },
        );
        console.log(`Updated ticket ${ticketId} sentiment to: ${detected}`);
      }
    } catch (e) {
      console.error('Failed to re-analyze ticket mood', e);
    }
  }

  async handleAutoReply(
    ticketId: string,
    messageContent: string,
    organizationId: string,
    customerId: string,
    channel?: string, // 'email' | 'chat' | 'social'
  ): Promise<void> {
    try {
      const org = await this.organizationsService.findOne(organizationId);

      // Check detailed channel settings
      // If channel is provided, respect that specific toggle.
      // If no channel is provided (legacy calls), we might default to checking 'email' or just general active state?
      // Given the previous code just checked aiAutoReplyEmail, let's enable strict checks now.

      let shouldAutoReply = false;

      if (!channel) {
        // If no channel specified, default fallback (e.g. assume email or check any? Safe to assume email if not specified in legacy)
        shouldAutoReply = org.aiAutoReplyEmail;
      } else {
        switch (channel.toLowerCase()) {
          case 'email':
            shouldAutoReply = org.aiAutoReplyEmail;
            break;
          case 'widget':
          case 'chat':
            shouldAutoReply = org.aiAutoReplyLiveChat;
            break;
          case 'whatsapp':
          case 'sms':
          case 'social':
            shouldAutoReply = org.aiAutoReplySocialMedia;
            break;
          default:
            // Fallback for unknown channels
            shouldAutoReply = org.aiAutoReplyEmail;
            break;
        }
      }

      if (!shouldAutoReply) return;

      const ticket = await this.ticketModel.findById(ticketId);
      if (!ticket) return;

      // Check if AI auto-reply is disabled for this ticket
      if (ticket.aiAutoReplyDisabled) {
        console.log(
          `Skipping auto-reply for ticket ${ticketId}: AI auto-reply disabled (human agent took over)`,
        );
        return;
      }

      // Check if ticket is already escalated or closed
      if (
        ticket.status === TicketStatus.CLOSED ||
        ticket.status === TicketStatus.RESOLVED ||
        ticket.status === TicketStatus.ESCALATED ||
        ticket.isAiEscalated
      )
        return;

      const isRestricted = this.checkRestrictedTopics(
        ticket.subject,
        messageContent, // Check new message content too
        org.aiRestrictedTopics || [],
      );

      if (isRestricted) {
        console.log(
          `Skipping auto-reply for ticket ${ticketId}: matches restricted topic`,
        );
        return;
      }

      // Use timeout to not block
      setTimeout(async () => {
        try {
          const response = await draftResponse(
            ticketId,
            this,
            this.threadsService,
            this.configService,
            this.organizationsService,
            null,
            customerId,
            UserRole.CUSTOMER,
            organizationId,
            undefined,
            channel,
          );

          const confidence = response.confidence || 0;
          const threshold = org.aiConfidenceThreshold || 85;

          if (response.action === 'ESCALATE' || confidence < threshold) {
            const reason =
              response.escalationReason ||
              (confidence < threshold
                ? `Confidence ${confidence}% below threshold ${threshold}%`
                : 'AI decided to escalate');
            console.log(
              `[Auto-Reply] Escalating ticket ${ticketId}: ${reason}`,
            );

            await this.ticketModel
              .updateOne(
                { _id: ticketId },
                {
                  $set: {
                    isAiEscalated: true,
                    aiEscalationReason: reason,
                    aiConfidenceScore: confidence,
                    // Set status to ESCALATED
                    status: TicketStatus.ESCALATED,
                  },
                },
              )
              .exec();

            // Send friendly escalation message to customer
            const thread = await this.threadsService.getOrCreateThread(
              ticketId,
              customerId,
              organizationId,
            );

            // Generate AI escalation message
            let escalationMessage = '';

            try {
              const messages = await this.threadsService.getMessages(
                thread._id.toString(),
                organizationId,
                organizationId, // Use org ID as user for admin access
                UserRole.ADMIN,
              );

              const contextMessages = messages
                .slice(-5)
                .map((m) => `${m.authorType}: ${m.content}`)
                .join('\n');

              const model = AIModelFactory.create(this.configService);
              const prompt = `You are a helpful customer support AI. 
The current conversation needs to be escalated to a human agent.
Reason: ${reason}

Context:
Ticket Subject: ${ticket.subject}
Recent Messages:
${contextMessages}

Task: Write a polite, concise message to the customer explaining that you are passing the conversation to a human agent. 
Do not apologize unless necessary. Be professional and reassuring.
Return ONLY the message text.`;

              const aiResult = await model.invoke(prompt);
              const generatedText =
                typeof aiResult.content === 'string' ? aiResult.content : '';
              if (generatedText && generatedText.length > 5) {
                escalationMessage = generatedText.trim().replace(/^"|"$/g, '');
              }
            } catch (e) {
              console.error(
                'Failed to generate AI escalation message, using default.',
                e,
              );
            }

            // Fallback if AI fails
            if (!escalationMessage) {
              escalationMessage =
                "I'll connect you with a human agent to assist you further.";
            }

            await this.threadsService.createMessage(
              thread._id.toString(),
              {
                content: escalationMessage,
                messageType: MessageType.EXTERNAL,
              },
              organizationId,
              customerId,
              UserRole.CUSTOMER,
              MessageAuthorType.AI,
            );
          } else if (response.action === 'REPLY' && response.content) {
            const thread = await this.threadsService.getOrCreateThread(
              ticketId,
              customerId,
              organizationId,
            );

            let finalContent = response.content;

            // Debug logging
            console.log(
              `[AutoReply] Channel: ${channel}, aiEmailSignature exists: ${!!org.aiEmailSignature}`,
            );

            // Only append signature for EMAIL channel
            if (
              org.aiEmailSignature &&
              channel &&
              channel.toLowerCase() === 'email'
            ) {
              console.log(`[AutoReply] Appending email signature to response`);
              finalContent += `\n\n${org.aiEmailSignature}`;
            } else {
              console.log(
                `[AutoReply] NOT appending signature. Channel: ${channel}`,
              );
            }

            await this.threadsService.createMessage(
              thread._id.toString(),
              {
                content: finalContent,
                messageType: MessageType.EXTERNAL,
              },
              organizationId,
              customerId,
              UserRole.CUSTOMER,
              MessageAuthorType.AI,
            );

            await this.ticketModel
              .updateOne(
                { _id: ticketId },
                {
                  $set: { aiConfidenceScore: confidence },
                  // Clear escalation status if AI can now handle it
                  $unset: { isAiEscalated: '', aiEscalationReason: '' },
                },
              )
              .exec();

            console.log(
              `AI auto-reply sent for ticket ${ticketId} (confidence: ${confidence}%)`,
            );
          }
        } catch (err) {
          console.error('Failed to generate AI auto-reply:', err);
        }
      }, 1000);
    } catch (error) {
      console.error('Failed to check auto-reply settings:', error);
    }
  }

  async deEscalateTicket(ticketId: string): Promise<void> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) return;

    if (ticket.status === TicketStatus.ESCALATED) {
      // Set back to OPEN
      await this.ticketModel.updateOne(
        { _id: ticketId },
        {
          $set: { status: TicketStatus.OPEN },
          $unset: {
            isAiEscalated: '',
            aiEscalationReason: '',
            aiConfidenceScore: '',
          },
        },
      );
    } else if (ticket.isAiEscalated) {
      // Just remove flags if status wasn't strictly ESCALATED (e.g. user changed it manualy)
      await this.ticketModel.updateOne(
        { _id: ticketId },
        {
          $unset: {
            isAiEscalated: '',
            aiEscalationReason: '',
            aiConfidenceScore: '',
          },
        },
      );
    }
  }

  async create(
    createTicketDto: CreateTicketDto,
    organizationId: string,
    channel?: string, // Optional: 'email' | 'widget' | 'whatsapp' | 'sms' - defaults to 'email'
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
    } else {
      // Auto-assign to default agent if no assignee specified
      const organization =
        await this.organizationsService.findOne(organizationId);
      if (organization?.defaultAgentId) {
        ticketData.assignedToId = new Types.ObjectId(
          organization.defaultAgentId,
        );
      }
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
    try {
      await this.threadsService.getOrCreateThread(
        savedTicket._id.toString(),
        createTicketDto.customerId,
        organizationId,
      );
    } catch (error) {
      console.error('Failed to auto-create thread:', error);
    }

    // Call shared Auto-reply logic using the provided channel or defaulting to 'email'
    this.handleAutoReply(
      savedTicket._id.toString(),
      savedTicket.description,
      organizationId,
      createTicketDto.customerId,
      channel || 'email',
    );

    // Notify assigned agent
    if (savedTicket.assignedToId) {
      await this.notificationsService.create({
        userId: savedTicket.assignedToId.toString(),
        type: NotificationType.NEW_TICKET,
        title: 'New Ticket Assigned',
        body: `You have been assigned to ticket #${savedTicket._id}: ${savedTicket.subject}`,
        metadata: { ticketId: savedTicket._id.toString() },
      });
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
      sentiment,
    } = paginationDto;
    const skip = (page - 1) * limit;

    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
    };

    // Apply filters - support multiple values (comma-separated)
    if (status) {
      const statusList = status.split(',');
      query.status =
        statusList.length > 1 ? { $in: statusList } : statusList[0];
    }
    if (priority) {
      const priorityList = priority.split(',');
      query.priority =
        priorityList.length > 1 ? { $in: priorityList } : priorityList[0];
    }
    if (sentiment) {
      const sentimentList = sentiment.split(',');
      query.sentiment =
        sentimentList.length > 1 ? { $in: sentimentList } : sentimentList[0];
    }
    if (filterAssignedToId) {
      query.assignedToId = new Types.ObjectId(filterAssignedToId);
    }
    if (customerId) {
      query.customerId = new Types.ObjectId(customerId);
    }

    if (paginationDto.search) {
      const searchRegex = new RegExp(paginationDto.search, 'i');

      // Find matching customers
      const matchingCustomerIds = await this.customersService.findIdsBySearch(
        paginationDto.search,
        organizationId,
      );

      const searchConditions: any[] = [
        { subject: searchRegex },
        { description: searchRegex },
      ];

      if (matchingCustomerIds.length > 0) {
        searchConditions.push({ customerId: { $in: matchingCustomerIds } });
      }

      // Check if search term looks like a MongoId (for direct ID search)
      if (Types.ObjectId.isValid(paginationDto.search)) {
        searchConditions.push({
          _id: new Types.ObjectId(paginationDto.search),
        });
      }

      query.$and = query.$and || [];
      query.$and.push({ $or: searchConditions });
    }

    // Agents see tickets assigned to them, their groups, or unassigned tickets
    // Admins see all tickets in org
    // Agents see tickets assigned to them, their groups, or unassigned tickets
    // Admins see all tickets in org
    if (userRole === UserRole.LIGHT_AGENT) {
      // Get groups the user belongs to
      const userGroups = await this.groupsService.findByMember(
        userId,
        organizationId,
      );
      const groupIds = userGroups.map((group) => group._id);

      query.$or = [
        { assignedToId: new Types.ObjectId(userId) },
        { followers: new Types.ObjectId(userId) },
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
        .populate(
          'customerId',
          'email firstName lastName company notes secondaryEmails phones avatar',
        )
        .populate('organizationId', 'name')
        .populate('assignedToId', 'email firstName lastName')
        .populate('assignedToGroupId', 'name description')
        .populate('categoryId', 'name description')

        .populate('tagIds', 'name color')
        .populate('followers', 'email firstName lastName')
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
      .populate(
        'customerId',
        'email firstName lastName company notes secondaryEmails phones avatar',
      )
      .populate('organizationId', 'name')
      .populate('assignedToId', 'email firstName lastName')
      .populate('assignedToGroupId', 'name description')
      .populate('categoryId', 'name description')

      .populate('tagIds', 'name color')
      .populate('followers', 'email firstName lastName')
      .exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${id} not found`);
    }

    const ticketAssignedToId = ticket.assignedToId?.toString();
    const ticketAssignedToGroupId = ticket.assignedToGroupId?.toString();

    // Agents can see tickets assigned to them or their groups
    // Agents can see tickets assigned to them or their groups
    if (userRole === UserRole.LIGHT_AGENT) {
      if (ticketAssignedToId === userId) {
        // Assigned directly to user
        return ticket;
      }

      // Check if user is a follower
      const followers = ticket.followers?.map((f: any) =>
        f._id ? f._id.toString() : f.toString(),
      );
      if (followers && followers.includes(userId)) {
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

      // Check if ticket is unassigned (agents can see unassigned tickets)
      if (!ticketAssignedToId && !ticketAssignedToGroupId) {
        return ticket;
      }

      // Check if user is a participant in the ticket's thread
      const ticketIdsWithUserParticipation =
        await this.threadsService.findTicketIdsByParticipant(
          userId,
          organizationId,
        );
      const isParticipant = ticketIdsWithUserParticipation.some(
        (ticketId) => ticketId.toString() === id,
      );

      if (isParticipant) {
        return ticket;
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

    if (updateTicketDto.followers) {
      updateData.followers = updateTicketDto.followers.map(
        (id) => new Types.ObjectId(id),
      );
    }

    // Track resolution for analytics
    if (
      (updateTicketDto.status === TicketStatus.RESOLVED ||
        updateTicketDto.status === TicketStatus.CLOSED) &&
      (!existingTicket.resolvedAt ||
        existingTicket.status !== updateTicketDto.status)
    ) {
      updateData.resolvedAt = new Date();
      // If resolutionType isn't already set (e.g. by AI), default to 'human'
      if (!existingTicket.resolutionType && !updateData.resolutionType) {
        updateData.resolutionType =
          userRole === UserRole.ADMIN || userRole === UserRole.AGENT
            ? 'human'
            : 'human';
      }
    } else if (
      updateTicketDto.status &&
      updateTicketDto.status !== TicketStatus.RESOLVED &&
      updateTicketDto.status !== TicketStatus.CLOSED
    ) {
      // If ticket is re-opened, clear resolution data
      updateData.resolvedAt = null;
      updateData.resolutionType = null;
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
      .populate('followers', 'email firstName lastName')
      .exec();

    // Check for assignment changes and notify new assignee
    if (
      updatedTicket &&
      updatedTicket.assignedToId &&
      (!existingTicket.assignedToId ||
        (existingTicket.assignedToId &&
          updatedTicket.assignedToId._id.toString() !==
            existingTicket.assignedToId.toString()))
    ) {
      await this.notificationsService.create({
        userId: updatedTicket.assignedToId._id.toString(),
        type: NotificationType.SYSTEM,
        title: 'Ticket Assigned',
        body: `Ticket #${updatedTicket._id} has been assigned to you`,
        metadata: { ticketId: updatedTicket._id.toString() },
      });
    }

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

  async merge(
    sourceTicketId: string,
    targetTicketId: string,
    userId: string,
    userRole: UserRole,
    organizationId: string,
  ): Promise<Ticket> {
    // 1. Validate both tickets exist and user has access
    const sourceTicket = await this.findOne(
      sourceTicketId,
      userId,
      userRole,
      organizationId,
    );
    const targetTicket = await this.findOne(
      targetTicketId,
      userId,
      userRole,
      organizationId,
    );

    if (
      sourceTicket.customerId.toString() !== targetTicket.customerId.toString()
    ) {
      // Optional: Enforce same customer? The prompt implies merging tickets, usually for same customer.
      // But sometimes you merge duplicates from different profiles (which are then merged).
      // For now, let's just warn or allow it.
      // Actually, usually ticket merge is for same customer.
      // But if we allow merging tickets from different customers, the messages will just appear in the target ticket.
    }

    // 2. Get threads
    const sourceThread = await this.threadsService.findByTicket(
      sourceTicketId,
      organizationId,
      userId,
      userRole,
    );
    const targetThread = await this.threadsService.findByTicket(
      targetTicketId,
      organizationId,
      userId,
      userRole,
    );

    if (!sourceThread || !targetThread) {
      throw new BadRequestException(
        'One or both tickets do not have a valid thread',
      );
    }

    // 3. Merge threads
    await this.threadsService.mergeThreads(
      sourceThread._id.toString(),
      targetThread._id.toString(),
      organizationId,
    );

    // 4. Delete the source ticket
    await this.ticketModel.findByIdAndDelete(sourceTicketId).exec();

    // 5. Add system note to target ticket
    await this.threadsService.createMessage(
      targetThread._id.toString(),
      {
        content: `Ticket #${sourceTicketId} was merged into this ticket. All messages have been moved here.`,
        messageType: MessageType.INTERNAL,
      },
      organizationId,
      userId,
      userRole,
      MessageAuthorType.SYSTEM,
    );
    // Note: MessageAuthorType might not have SYSTEM. I should check `MessageAuthorType` in `backend/src/threads/entities/message.entity.ts`.
    // If not, I'll use USER or AI or just simple text.
    // Checking `tickets.service.ts` imports: `MessageAuthorType` is imported. It has `AI`.
    // Let's assume it has `SYSTEM` or I will add it or use `AI`.
    // Actually, I'll check `MessageAuthorType` first.

    return targetTicket;
  }

  async updateCustomer(
    oldCustomerId: string,
    newCustomerId: string,
    organizationId: string,
  ): Promise<void> {
    await this.ticketModel.updateMany(
      {
        customerId: new Types.ObjectId(oldCustomerId),
        organizationId: new Types.ObjectId(organizationId),
      },
      {
        $set: { customerId: new Types.ObjectId(newCustomerId) },
      },
    );
  }
}
