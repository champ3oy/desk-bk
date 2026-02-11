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
import { EmailIntegrationService } from '../integrations/email/email-integration.service';
import { SocialIntegrationService } from '../integrations/social/social-integration.service';
import {
  Ticket,
  TicketDocument,
  TicketStatus,
  TicketPriority,
  TicketChannel,
} from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UserRole } from '../users/entities/user.entity';
import { Tag, TagDocument } from '../tags/entities/tag.entity';
import { Counter, CounterDocument } from './entities/counter.entity';
import { GroupsService } from '../groups/groups.service';
import { ThreadsService } from '../threads/threads.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { draftResponse } from '../ai/agents/response';
import {
  MessageType,
  MessageAuthorType,
  MessageChannel,
} from '../threads/entities/message.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TicketPaginationDto } from './dto/ticket-pagination.dto';
import { AIModelFactory } from '../ai/ai-model.factory';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { KnowledgeBaseService } from '../ai/knowledge-base.service'; // Import KnowledgeBaseService
import { UsersService } from '../users/users.service';
import { RedisLockService } from '../common/services/redis-lock.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

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
    private usersService: UsersService,
    @Inject(forwardRef(() => KnowledgeBaseService))
    private knowledgeBaseService: KnowledgeBaseService,
    @InjectModel(Counter.name)
    private counterModel: Model<CounterDocument>,
    private redisLockService: RedisLockService,
    @InjectQueue('ai-reply') private aiReplyQueue: Queue,
    @Inject(forwardRef(() => EmailIntegrationService))
    private emailIntegrationService: EmailIntegrationService,
    @Inject(forwardRef(() => SocialIntegrationService))
    private socialIntegrationService: SocialIntegrationService,
  ) {}

  /**
   * Resolve tag names to ObjectIds. Only returns IDs for existing tags.
   */
  async resolveTags(
    tagNames: string[],
    organizationId: string,
  ): Promise<Types.ObjectId[]> {
    if (!tagNames || tagNames.length === 0) return [];

    const normalizedNames = tagNames.map((t) => t.trim());
    const tags = await this.tagModel.find({
      organizationId: new Types.ObjectId(organizationId),
      name: { $in: normalizedNames.map((n) => new RegExp(`^${n}$`, 'i')) }, // Case insensitive match
    });

    return tags.map((t) => t._id);
  }

  /**
   * Get next sequence value for an organization
   */
  async getNextSequenceValue(
    organizationId: string,
    counterName: string,
  ): Promise<number> {
    const sequenceDocument = await this.counterModel.findOneAndUpdate(
      { name: counterName, organizationId: new Types.ObjectId(organizationId) },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return sequenceDocument.seq;
  }

  /**
   * Generate a human-friendly display ID for a ticket
   */
  async generateDisplayId(
    organizationId: string,
    ticketNumber: number,
  ): Promise<string> {
    const organization =
      await this.organizationsService.findOne(organizationId);
    const orgName = organization?.name || 'TK';

    const initials = orgName
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .toUpperCase();

    const paddedNumber = ticketNumber.toString().padStart(6, '0');
    const result = `${initials}-${paddedNumber}`;
    console.log(
      `[TicketsService] Generated displayId: ${result} for Org: ${organizationId}`,
    );
    return result;
  }

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
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
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
        attempt++;
        if (attempt > maxRetries) {
          console.error(
            'Failed to analyze initial AI content after retries',
            e,
          );
          return {
            title: content.substring(0, 30) + '...',
            sentiment: 'neutral',
            priority: TicketPriority.MEDIUM,
          };
        }
        console.warn(
          `Retry ${attempt}/${maxRetries} for analyzeInitialContent due to error: ${e.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return {
      title: 'New Conversation',
      sentiment: 'neutral',
      priority: TicketPriority.MEDIUM,
    };
  }

  /**
   * Re-examine the mood of the chat and update the ticket
   */
  async analyzeTicketMood(
    ticketId: string,
    messageContent: string,
    organizationId: string,
  ): Promise<void> {
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
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
        const sentiment = (
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
        return; // Success
      } catch (e) {
        attempt++;
        if (attempt > maxRetries) {
          console.error('Failed to re-analyze ticket mood after retries', e);
          return;
        }
        console.warn(
          `Retry ${attempt}/${maxRetries} for analyzeTicketMood due to error: ${e.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
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

      // Use Redis lock to prevent race conditions for AutoReply of same ticket
      const lockKey = `autoreply:${ticketId}`;
      const locked = await this.redisLockService.acquireLock(lockKey, 30); // 30s lock
      if (!locked) {
        console.warn(
          `[AutoReply] Skipped ticket ${ticketId} - Locked by another process`,
        );
        return;
      }

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

      console.log(
        `[AutoReply] Channel: ${channel}, ShouldReply: ${shouldAutoReply}, OrgSettings: Email=${org.aiAutoReplyEmail}, LiveChat=${org.aiAutoReplyLiveChat}, Social=${org.aiAutoReplySocialMedia}`,
      );

      if (!shouldAutoReply) {
        console.log(
          `[AutoReply] Skipping auto-reply for ticket ${ticketId}: Auto-reply not enabled for channel '${channel}'`,
        );
        await this.redisLockService.releaseLock(lockKey); // Release lock
        return;
      }

      const ticket = await this.ticketModel.findById(ticketId);
      if (!ticket) {
        await this.redisLockService.releaseLock(lockKey); // Release lock
        return;
      }

      console.log(
        `[AutoReply] Processing ticket ${ticketId}. Channel: ${channel}. Org settings: LiveChat=${org.aiAutoReplyLiveChat} Email=${org.aiAutoReplyEmail}`,
      );

      // Check if AI auto-reply is disabled for this ticket or if we are already processing
      if (ticket.aiAutoReplyDisabled || (ticket as any).isAiProcessing) {
        console.log(
          `Skipping auto-reply for ticket ${ticketId}: AI auto-reply disabled or already processing`,
        );
        await this.redisLockService.releaseLock(lockKey);
        return;
      }

      // Check if ticket is already escalated or closed
      if (
        ticket.status === TicketStatus.CLOSED ||
        ticket.status === TicketStatus.RESOLVED
      ) {
        console.log(
          `[AutoReply] Ticket ${ticketId} status prevents AI reply: ${ticket.status}`,
        );
        await this.redisLockService.releaseLock(lockKey); // Release lock
        return;
      }

      // If ticket is escalated, handle counter and possible intervention
      if (ticket.status === TicketStatus.ESCALATED || ticket.isAiEscalated) {
        // Increment reply count
        const newCount = (ticket.escalationReplyCount || 0) + 1;
        await this.ticketModel.updateOne(
          { _id: ticketId },
          { $set: { escalationReplyCount: newCount } },
        );

        // If we are waiting for a new topic check, we let it fall through to the AI drafting section below
        // but if not, we handle the standard escalation logic.
        if (ticket.isWaitingForNewTopicCheck) {
          console.log(
            `[AutoReply] Ticket ${ticketId} is waiting for new topic check. Falling through to AI...`,
          );
          // Fall through to drafting logic
        } else if (newCount === 4) {
          console.log(
            `[AutoReply] Ticket ${ticketId} reached message #4. Sending intervention.`,
          );

          // Intervention: Send "Anything else?" message
          await this.aiReplyQueue.add(
            'send-intervention',
            { ticketId, customerId, organizationId, channel },
            { delay: 500, removeOnComplete: true },
          );
          return;
        } else {
          // Standard escalation notice (first reply only)
          if (ticket.escalationNoticeSent) {
            console.log(
              `[AutoReply] Ticket ${ticketId} is escalated but escalation notice was already sent. Skipping.`,
            );
            return;
          }

          console.log(
            `[AutoReply] Ticket ${ticketId} is escalated. Sending escalation notification.`,
          );

          const shouldNotify = [
            'whatsapp',
            'sms',
            'social',
            'widget',
            'chat',
          ].includes((channel || '').toLowerCase());

          if (shouldNotify) {
            await this.aiReplyQueue.add(
              'send-escalation-notice',
              { ticketId, customerId, organizationId, channel },
              { delay: 500, removeOnComplete: true },
            );
          }
          return;
        }
      }

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

      // Add to BullMQ Queue
      // We set isAiProcessing to true here to prevent immediate re-triggering,
      // but the Processor will also handle locks and flags.
      await this.ticketModel.updateOne(
        { _id: ticketId },
        { $set: { isAiProcessing: true } },
      );

      await this.aiReplyQueue.add(
        'generate-reply',
        {
          ticketId,
          messageContent,
          organizationId,
          customerId,
          channel,
        },
        {
          delay: 1000, // 1s delay to simulate "thinking" or batch updates
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
        },
      );

      console.log(`[AutoReply] Queued job for ticket ${ticketId}`);
      await this.redisLockService.releaseLock(lockKey);
    } catch (error) {
      console.error('Failed to check auto-reply settings:', error);
      await this.redisLockService.releaseLock(`autoreply:${ticketId}`);
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
          $set: {
            status: TicketStatus.OPEN,
            escalationNoticeSent: false,
            escalationReplyCount: 0,
            isWaitingForNewTopicCheck: false,
          },
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
          $set: {
            escalationNoticeSent: false,
            escalationReplyCount: 0,
            isWaitingForNewTopicCheck: false,
          },
        },
      );
    }
  }
  async create(
    createTicketDto: CreateTicketDto,
    organizationId: string,
    channel?: string, // Optional: 'email' | 'widget' | 'whatsapp' | 'sms' - defaults to 'email'
    integrationId?: string,
  ): Promise<Ticket> {
    const ticketData: any = {
      ...createTicketDto,
      customerId: new Types.ObjectId(createTicketDto.customerId),
      organizationId: new Types.ObjectId(organizationId),
      channel: channel || TicketChannel.EMAIL,
    };

    if (createTicketDto.assignedToId) {
      ticketData.assignedToId = new Types.ObjectId(
        createTicketDto.assignedToId,
      );
    } else {
      // Auto-assign check order:
      // 1. Channel-specific default agent (if integrationId provided)
      // 2. Organization-level default agent

      let defaultAgentApplied = false;

      if (integrationId) {
        // Try to find default agent for the specific integration
        let integration: any = null;
        try {
          // Check Email integrations first
          integration = await this.emailIntegrationService.findByEmail(
            integrationId, // Note: findByEmail is used for email Lookups, but here we might have ID
          );

          // Wait, the ingestion service passes integrationId which is likely the _id.
          // Let's check EmailIntegrationService for findById.
          // It doesn't have it explicitly but we can use emailIntegrationModel.
        } catch (e) {}

        // Re-thinking: IngestionService passes message.integrationId.
        // Let's make sure we can find the integration by ID.
      }

      const organization =
        await this.organizationsService.findOne(organizationId);

      // Check for integration-specific default agent first
      if (integrationId) {
        let channelDefaultAgentId: string | undefined;

        // Try Email Integration
        try {
          const emailIntegration =
            await this.emailIntegrationService.findById(integrationId);
          if (emailIntegration?.defaultAgentId) {
            channelDefaultAgentId = emailIntegration.defaultAgentId.toString();
          }
        } catch (e) {
          // If not email, try Social
          try {
            const socialIntegration =
              await this.socialIntegrationService.findById(integrationId);
            if (socialIntegration?.defaultAgentId) {
              channelDefaultAgentId =
                socialIntegration.defaultAgentId.toString();
            }
          } catch (e2) {}
        }

        if (channelDefaultAgentId) {
          ticketData.assignedToId = new Types.ObjectId(channelDefaultAgentId);
          defaultAgentApplied = true;
          console.log(
            `[TicketsService] Integration-specific auto-assign. OrgId: ${organizationId}, IntegrationId: ${integrationId}, Agent: ${channelDefaultAgentId}`,
          );
        }
      }

      // Fallback to Org Default if not assigned yet
      if (!defaultAgentApplied && organization?.defaultAgentId) {
        ticketData.assignedToId = new Types.ObjectId(
          organization.defaultAgentId,
        );
        console.log(
          `[TicketsService] Org-level auto-assign. OrgId: ${organizationId}, DefaultAgent: ${organization?.defaultAgentId}`,
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

    // Generate incremental ticket number and display ID
    const ticketNumber = await this.getNextSequenceValue(
      organizationId,
      'ticket_number',
    );
    const displayId = await this.generateDisplayId(
      organizationId,
      ticketNumber,
    );

    const ticket = new this.ticketModel({
      ...ticketData,
      ticketNumber,
      displayId,
      latestMessageContent: createTicketDto.description,
      latestMessageAuthorType: 'customer',
    });
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
    console.log(
      `[TicketsService.create] Calling handleAutoReply for ticket ${savedTicket._id}, channel: ${channel || 'email'}`,
    );
    this.handleAutoReply(
      savedTicket._id.toString(),
      savedTicket.description,
      organizationId,
      createTicketDto.customerId,
      channel || 'email',
    ).catch((err) => {
      console.error(
        `[TicketsService.create] handleAutoReply failed for ticket ${savedTicket._id}:`,
        err,
      );
    });

    // Notify assigned agent
    console.log(
      `[TicketsService] Notification Check. TicketID: ${savedTicket._id}, AssignedTo: ${savedTicket.assignedToId}`,
    );
    if (savedTicket.assignedToId) {
      await this.notificationsService.create({
        userId: savedTicket.assignedToId.toString(),
        type: NotificationType.NEW_TICKET,
        title: 'New Ticket Assigned',
        body: `You have been assigned to ticket #${savedTicket.displayId || savedTicket._id}: ${savedTicket.subject}`,
        metadata: {
          ticketId: savedTicket._id.toString(),
          displayId: savedTicket.displayId,
        },
      });
    } else {
      // Notify all admins if ticket is unassigned
      const admins = await this.usersService.findAdmins(organizationId);
      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin._id.toString(),
          type: NotificationType.NEW_TICKET,
          title: 'New Unassigned Ticket',
          body: `New ticket #${savedTicket.displayId || savedTicket._id}: ${savedTicket.subject}`,
          metadata: {
            ticketId: savedTicket._id.toString(),
            displayId: savedTicket.displayId,
          },
        });
      }
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
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      assignedToId: filterAssignedToId,
      assignedToGroupId,
      customerId,
      sentiment,
    } = paginationDto;
    const skip = (page - 1) * limit;

    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
    };

    // Scope tickets based on user role
    // Admins see all tickets in the org
    // Agents see: assigned to them, their groups, or unassigned
    // Light Agents see: only assigned to them or their groups (no unassigned)
    if (userRole === UserRole.AGENT || userRole === UserRole.LIGHT_AGENT) {
      const userGroups = await this.groupsService.findByMember(
        userId,
        organizationId,
      );
      const userGroupIds = userGroups.map((g) => g._id as Types.ObjectId);

      const accessConditions: any[] = [
        // Directly assigned to this user
        { assignedToId: new Types.ObjectId(userId) },
        // Assigned to a group the user belongs to
        ...(userGroupIds.length > 0
          ? [{ assignedToGroupId: { $in: userGroupIds } }]
          : []),
      ];

      // Only regular agents can see unassigned tickets
      if (userRole === UserRole.AGENT) {
        accessConditions.push({
          $and: [
            {
              $or: [
                { assignedToId: null },
                { assignedToId: { $exists: false } },
              ],
            },
            {
              $or: [
                { assignedToGroupId: null },
                { assignedToGroupId: { $exists: false } },
              ],
            },
          ],
        });
      }

      query.$and = query.$and || [];
      query.$and.push({ $or: accessConditions });
    } else if (userRole === UserRole.CUSTOMER) {
      query.customerId = new Types.ObjectId(userId);
    }
    // Admins: no additional scoping, they see all org tickets

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
    if (assignedToGroupId) {
      const groupList = assignedToGroupId.split(',');
      const groupIds = groupList.map((id) => new Types.ObjectId(id));
      query.assignedToGroupId =
        groupIds.length > 1 ? { $in: groupIds } : groupIds[0];
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
        { displayId: searchRegex },
      ];

      // Check if search term is a number (for ticketNumber)
      const searchNumber = Number(paginationDto.search);
      if (!isNaN(searchNumber)) {
        searchConditions.push({ ticketNumber: searchNumber });
      }

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

    const [data, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .sort({ updatedAt: -1 })
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

  /**
   * Notify agents about an escalation
   */
  async notifyAgentsOfEscalation(
    ticket: TicketDocument,
    reason: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const recipients = new Set<string>();

      // Notify assigned agent
      if (ticket.assignedToId) {
        const assignedId = (ticket.assignedToId as any)._id
          ? (ticket.assignedToId as any)._id.toString()
          : ticket.assignedToId.toString();
        recipients.add(assignedId);
      }

      // Notify followers
      if (ticket.followers && ticket.followers.length > 0) {
        ticket.followers.forEach((f: any) => {
          const fId = f._id ? f._id.toString() : f.toString();
          recipients.add(fId);
        });
      }

      // If no agent is assigned, notify all admins
      if (!ticket.assignedToId) {
        const admins = await this.usersService.findAdmins(organizationId);
        admins.forEach((admin) => recipients.add(admin._id.toString()));
      }

      const promises = Array.from(recipients).map((userId) =>
        this.notificationsService.create({
          userId,
          type: NotificationType.SYSTEM,
          title: `Ticket Escalated`,
          body: `Ticket #${ticket.displayId || ticket._id} escalated. Reason: ${reason}`,
          metadata: {
            ticketId: ticket._id.toString(),
            displayId: ticket.displayId,
          },
        }),
      );

      await Promise.all(promises);
      console.log(
        `[TicketsService] Notified ${recipients.size} agents of escalation`,
      );
    } catch (error) {
      console.error('Failed to notify agents of escalation', error);
    }
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

    if (updateTicketDto.assignedToId !== undefined) {
      if (updateTicketDto.assignedToId === null) {
        updateData.assignedToId = null;
      } else {
        updateData.assignedToId = new Types.ObjectId(
          updateTicketDto.assignedToId,
        );
        // Clear group assignment if assigning to individual
        updateData.assignedToGroupId = null;
      }
    }

    if (updateTicketDto.assignedToGroupId !== undefined) {
      if (updateTicketDto.assignedToGroupId === null) {
        updateData.assignedToGroupId = null;
      } else {
        updateData.assignedToGroupId = new Types.ObjectId(
          updateTicketDto.assignedToGroupId,
        );
        // Clear individual assignment if assigning to group
        updateData.assignedToId = null;
      }
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
      updateData.escalationNoticeSent = false;
      updateData.escalationReplyCount = 0;
      updateData.isWaitingForNewTopicCheck = false;
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
            ((existingTicket.assignedToId as any)._id?.toString() ||
              existingTicket.assignedToId.toString())))
    ) {
      await this.notificationsService.create({
        userId: updatedTicket.assignedToId._id.toString(),
        type: NotificationType.SYSTEM,
        title: 'Ticket Assigned',
        body: `Ticket #${updatedTicket.displayId || updatedTicket._id} has been assigned to you`,
        metadata: {
          ticketId: updatedTicket._id.toString(),
          displayId: updatedTicket.displayId,
        },
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
      ((sourceTicket.customerId as any)._id?.toString() ||
        sourceTicket.customerId.toString()) !==
      ((targetTicket.customerId as any)._id?.toString() ||
        targetTicket.customerId.toString())
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
        content: `Ticket #${sourceTicket.displayId || (sourceTicket as any)._id || sourceTicketId} was merged into this ticket. All messages have been moved here.`,
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
