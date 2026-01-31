import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { EmailParser } from './parsers/email.parser';
import { SmsParser } from './parsers/sms.parser';
import { WhatsAppParser } from './parsers/whatsapp.parser';
import { WidgetParser } from './parsers/widget.parser';
import { OrganizationResolver } from './resolvers/organization.resolver';
import { CustomerResolver } from './resolvers/customer.resolver';
import { TicketResolver } from './resolvers/ticket.resolver';
import { PendingReviewService } from './services/pending-review.service';
import { ThreadsService } from '../threads/threads.service';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service'; // Added UsersService
import { UserRole, UserDocument } from '../users/entities/user.entity';
import {
  Message,
  MessageDocument,
  MessageChannel,
  MessageAuthorType,
  MessageType,
} from '../threads/entities/message.entity';
import { Thread, ThreadDocument } from '../threads/entities/thread.entity';
import {
  TicketStatus,
  TicketDocument,
  TicketPriority,
} from '../tickets/entities/ticket.entity';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(Thread.name)
    private threadModel: Model<ThreadDocument>,
    private emailParser: EmailParser,
    private smsParser: SmsParser,
    private whatsappParser: WhatsAppParser,
    private widgetParser: WidgetParser,
    private organizationResolver: OrganizationResolver,
    private customerResolver: CustomerResolver,
    private ticketResolver: TicketResolver,
    private pendingReviewService: PendingReviewService,
    @Inject(forwardRef(() => ThreadsService))
    private threadsService: ThreadsService,
    private ticketsService: TicketsService,
    private usersService: UsersService, // Injected UsersService
  ) {}

  /**
   * Main ingestion method - processes incoming messages
   */
  async ingest(
    payload: Record<string, any>,
    provider: string,
    channel: MessageChannel,
  ): Promise<{
    success: boolean;
    ticketId?: string;
    messageId?: string;
    error?: string;
  }> {
    try {
      // Step 1: Parse message
      const message = await this.parseMessage(payload, provider, channel);
      this.logger.debug(
        `Parsed message: channel=${message.channel}, sender=${message.senderEmail || message.senderPhone}`,
      );

      // Step 2: Resolve organization
      const organizationId = await this.organizationResolver.resolve(message);
      if (!organizationId) {
        // Queue for manual review
        await this.pendingReviewService.create(
          message,
          'Organization not found',
          payload,
        );
        return {
          success: false,
          error: 'Organization not found - queued for manual review',
        };
      }

      return await this.processMessage(message, organizationId, payload);
    } catch (error) {
      this.logger.error(
        `Error ingesting message: ${error.message}`,
        error.stack,
      );
      // Try to queue for manual review if we have partial data
      try {
        const message = await this.parseMessage(payload, provider, channel);
        await this.pendingReviewService.create(
          message,
          `Processing error: ${error.message}`,
          payload,
        );
      } catch (parseError) {
        this.logger.error(`Failed to queue for review: ${parseError.message}`);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Ingest with known organizationId (for integrations where we already know the org)
   */
  async ingestWithOrganization(
    payload: Record<string, any>,
    provider: string,
    channel: MessageChannel,
    organizationId: string,
  ): Promise<{
    success: boolean;
    ticketId?: string;
    messageId?: string;
    error?: string;
  }> {
    try {
      // Step 1: Parse message
      const message = await this.parseMessage(payload, provider, channel);
      this.logger.debug(
        `Parsed message: channel=${message.channel}, sender=${message.senderEmail || message.senderPhone}`,
      );
      this.logger.debug(`Full parsed message: ${JSON.stringify(message)}`);

      return await this.processMessage(message, organizationId, payload);
    } catch (error) {
      this.logger.error(
        `Error ingesting message: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process message after organization is known
   */
  private async processMessage(
    message: IncomingMessageDto,
    organizationId: string,
    payload: Record<string, any>,
  ): Promise<{
    success: boolean;
    ticketId?: string;
    messageId?: string;
    error?: string;
  }> {
    try {
      // Step 3: Check if sender is an Agent (Internal User)
      // This prevents Agents quoting themselves creating new tickets,
      // and allows Agents to reply via email to tickets.

      let agentUser: UserDocument | null = null;
      if (message.senderEmail) {
        agentUser = await this.usersService.findByEmailAndOrg(
          message.senderEmail,
          organizationId,
        );
      }

      // Step 4: Resolve ticket (reply vs new)
      // We pass customerId as null if it's an agent, so the resolver doesn't rely on customer logic
      // But we need a customerId for ticket creation, so we defer that check.

      let customerId: string | null = null;
      if (!agentUser) {
        // Normal flow: Resolve Customer
        customerId = await this.customerResolver.resolve(
          message,
          organizationId,
        );
        this.logger.debug(`Resolved customer: ${customerId}`);
      } else {
        this.logger.debug(
          `Sender is AGENT: ${agentUser.email} (${agentUser.role})`,
        );
      }

      // Resolve Ticket
      // Use customerId if we have it, otherwise null.
      // TicketResolver might use customerId to find recent threads.
      const existingTicketId = await this.ticketResolver.resolve(
        message,
        organizationId,
        customerId || '', // Pass empty string if agent, resolver should handle it
      );

      if (existingTicketId) {
        // This is a reply to an EXISTING ticket
        const replyAuthorId =
          customerId || (agentUser ? agentUser._id.toString() : '');
        return await this.handleReply(
          message,
          organizationId,
          replyAuthorId, // Use Agent ID if agent
          existingTicketId,
          !!agentUser, // isAgent flag
        );
      } else {
        // New Ticket Attempt
        if (agentUser) {
          // AGENTS should NOT create new tickets via email usually (unless configured).
          // This is arguably the "Loop" - an agent receives a notification, replies,
          // limits headers are stripped, and it looks like a new email.
          // We should REJECT or Treat as invalid.
          this.logger.warn(
            `Agent ${agentUser.email} attempted to create ticket via email (No matching thread found). Rejection to prevent loops.`,
          );
          return {
            success: false,
            error:
              'Agents cannot create new tickets via email. Please use the dashboard.',
          };
        }

        // Normal New Ticket
        if (!customerId) {
          throw new Error('Cannot create ticket: Customer not resolved');
        }
        return await this.handleNewTicket(message, organizationId, customerId);
      }
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Parse message based on channel
   */
  private async parseMessage(
    payload: Record<string, any>,
    provider: string,
    channel: MessageChannel,
  ): Promise<IncomingMessageDto> {
    switch (channel) {
      case MessageChannel.EMAIL:
        return this.emailParser.parse(payload, provider);
      case MessageChannel.SMS:
        return this.smsParser.parse(payload, provider);
      case MessageChannel.WHATSAPP:
        return this.whatsappParser.parse(payload, provider);
      case MessageChannel.WIDGET:
        return this.widgetParser.parse(payload);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  /**
   * Handle reply to existing ticket
   */
  private async handleReply(
    message: IncomingMessageDto,
    organizationId: string,
    authorId: string,
    ticketId: string,
    isAgent = false,
  ): Promise<{ success: boolean; ticketId: string; messageId: string }> {
    this.logger.debug(`Handling reply to ticket ${ticketId}`);

    // Check for duplicate message by externalMessageId
    const externalId = message.messageId
      ? message.messageId.replace(/^<|>$/g, '').trim()
      : message.inReplyTo
        ? message.inReplyTo.replace(/^<|>$/g, '').trim()
        : undefined;

    if (externalId) {
      const existingMessage = await this.messageModel.findOne({
        externalMessageId: externalId,
        organizationId: new Types.ObjectId(organizationId),
      });

      if (existingMessage) {
        this.logger.debug(
          `Message ${externalId} already exists, skipping duplicate`,
        );
        return {
          success: true,
          ticketId,
          messageId: existingMessage._id.toString(),
        };
      }
    }

    // Get or create thread for ticket
    let thread;
    if (isAgent) {
      // If agent, we don't have customerId to pass to getOrCreateThread
      // But the thread MUST exist for an existing ticket.
      thread = await this.threadModel.findOne({
        ticketId: new Types.ObjectId(ticketId),
        organizationId: new Types.ObjectId(organizationId),
      });

      if (!thread) {
        this.logger.error(
          `Thread not found for ticket ${ticketId} (Agent reply)`,
        );
        throw new Error('Thread not found');
      }
    } else {
      // If customer, ensure thread exists or check by session
      thread = await this.threadsService.getOrCreateThread(
        ticketId,
        authorId, // In this case authorId IS customerId
        organizationId,
        message.metadata,
      );
    }

    // Check for content duplicate within last 2 minutes (to catch different Message-IDs for same content)
    const contentDuplicate = await this.checkContentDuplicate(
      message.content,
      organizationId,
      authorId, // Changed from customerId
      thread._id.toString(),
    );

    if (contentDuplicate) {
      this.logger.debug(
        `Duplicate content found in thread, skipping duplicate message.`,
      );
      return {
        success: true,
        ticketId,
        messageId: contentDuplicate._id.toString(),
      };
    }

    // Create message in thread (directly, bypassing permission checks for customer messages)
    const createdMessage = new this.messageModel({
      threadId: new Types.ObjectId(thread._id),
      organizationId: new Types.ObjectId(organizationId),
      // Use EXTERNAL for Agent replies so they are visible to customers.
      // Use INTERNAL if you want them to be private notes (but email replies usually implies public comms).
      messageType: isAgent ? MessageType.EXTERNAL : MessageType.EXTERNAL,
      authorType: isAgent ? MessageAuthorType.USER : MessageAuthorType.CUSTOMER,
      authorId: new Types.ObjectId(authorId),
      content: message.content,
      rawBody: message.rawBody,
      channel: message.channel,
      readBy: [],
      isRead: false,
      externalMessageId: externalId,
      attachments: message.attachments || [],
    });

    await createdMessage.save();

    // Update ticket status if it was closed/resolved
    // (This would require access to TicketsService - we'll handle this separately if needed)

    this.logger.log(
      `Reply processed: ticket=${ticketId}, message=${createdMessage._id}`,
    );

    // Re-examine ticket mood and trigger auto-reply
    this.ticketsService
      .analyzeTicketMood(ticketId, message.content, organizationId)
      .catch((e) =>
        this.logger.error(
          `Failed to re-analyze mood for ticket ${ticketId}`,
          e,
        ),
      );

    // Trigger AI Auto-reply using the actual message channel
    // We don't await this to avoid blocking ingestion response
    // Trigger AI Auto-reply using the actual message channel
    // We don't await this to avoid blocking ingestion response
    // ONLY Trigger Auto-reply if it's a CUSTOMER message, not if an Agent replied.
    if (!isAgent) {
      const channelName = this.getChannelName(message.channel);
      this.ticketsService
        .handleAutoReply(
          ticketId,
          message.content,
          organizationId,
          authorId, // usage of generic authorId
          channelName,
        )
        .catch((e) =>
          this.logger.error(
            `Failed to trigger auto-reply for ticket ${ticketId}`,
            e,
          ),
        );
    }

    return {
      success: true,
      ticketId,
      messageId: createdMessage._id.toString(),
    };
  }

  /**
   * Handle new ticket creation
   */
  private async handleNewTicket(
    message: IncomingMessageDto,
    organizationId: string,
    customerId: string,
  ): Promise<{ success: boolean; ticketId: string; messageId: string }> {
    this.logger.debug(`Creating new ticket for customer ${customerId}`);

    // Check for duplicate message by externalMessageId
    const externalId = message.messageId
      ? message.messageId.replace(/^<|>$/g, '').trim()
      : undefined;

    if (externalId) {
      const existingMessage = await this.messageModel.findOne({
        externalMessageId: externalId,
        organizationId: new Types.ObjectId(organizationId),
      });

      if (existingMessage) {
        this.logger.debug(
          `Message ${externalId} already exists in ticket, skipping duplicate`,
        );
        // Get the ticket ID from the existing message's thread
        const thread = await this.threadModel.findById(
          existingMessage.threadId,
        );
        return {
          success: true,
          ticketId: thread?.ticketId.toString() || '',
          messageId: existingMessage._id.toString(),
        };
      }
    }

    // Check for content duplicate across ANY thread for this customer (catch rapid retries)
    const contentDuplicate = await this.checkContentDuplicate(
      message.content,
      organizationId,
      customerId,
    );

    if (contentDuplicate) {
      this.logger.debug(
        `Duplicate content found (new ticket attempt), linking to existing message.`,
      );
      const thread = await this.threadModel.findById(contentDuplicate.threadId);
      return {
        success: true,
        ticketId: thread?.ticketId.toString() || '',
        messageId: contentDuplicate._id.toString(),
      };
    }

    // Determine subject, sentiment, and priority
    let subject = message.subject;
    let sentiment = 'neutral';
    let priority = TicketPriority.MEDIUM;

    if (
      !subject ||
      subject === 'Chat Conversation' ||
      subject === 'New message'
    ) {
      // Use AI to generate title, sentiment, and priority from content
      const analysis = await this.ticketsService.analyzeInitialContent(
        message.content,
        organizationId,
      );
      subject = analysis.title;
      sentiment = analysis.sentiment;
      priority = analysis.priority;
    } else {
      // Even if subject exists, we might want to analyze sentiment/priority
      const analysis = await this.ticketsService.analyzeInitialContent(
        message.content,
        organizationId,
      );
      sentiment = analysis.sentiment;
      priority = analysis.priority;
    }

    // Create ticket with the correct channel for auto-reply
    const channelName = this.getChannelName(message.channel);
    const ticket = (await this.ticketsService.create(
      {
        subject: subject,
        description: message.content,
        customerId,
        status: TicketStatus.OPEN,
        sentiment,
        priority,
      },
      organizationId,
      channelName, // Pass channel for correct auto-reply routing
    )) as TicketDocument;

    // Get or create thread (should be auto-created, but ensure it exists)
    const thread = await this.threadsService.getOrCreateThread(
      (ticket as any)._id.toString(),
      customerId,
      organizationId,
      message.metadata, // Pass metadata (e.g. sessionId)
    );

    // Create initial message in thread (directly, bypassing permission checks for customer messages)
    const createdMessage = new this.messageModel({
      threadId: new Types.ObjectId(thread._id),
      organizationId: new Types.ObjectId(organizationId),
      messageType: MessageType.EXTERNAL,
      authorType: MessageAuthorType.CUSTOMER,
      authorId: new Types.ObjectId(customerId),
      content: message.content,
      rawBody: message.rawBody,
      channel: message.channel,
      readBy: [],
      isRead: false,
      externalMessageId: message.messageId
        ? message.messageId.replace(/^<|>$/g, '').trim()
        : undefined,
      attachments: message.attachments || [],
    });

    await createdMessage.save();

    this.logger.log(
      `New ticket created: ticket=${(ticket as any)._id}, message=${createdMessage._id}`,
    );

    // Note: Auto-reply is already triggered by ticketsService.create() above
    // so we don't need to call handleAutoReply here again

    return {
      success: true,
      ticketId: (ticket as any)._id.toString(),
      messageId: createdMessage._id.toString(),
    };
  }

  /**
   * Generate subject for messages without subject (SMS, WhatsApp)
   */
  private generateSubject(message: IncomingMessageDto): string {
    if (message.content) {
      // Use first 50 characters of content as subject
      const preview = message.content.substring(0, 50).trim();
      return preview.length < message.content.length
        ? `${preview}...`
        : preview;
    }
    return 'New message';
  }

  /**
   * Check for duplicate content from same author in a short time window.
   * This guards against providers sending different Message-IDs for identical content (e.g. retries).
   */
  private async checkContentDuplicate(
    content: string,
    organizationId: string,
    authorId: string,
    threadId?: string,
  ): Promise<MessageDocument | null> {
    const timeWindow = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
      authorId: new Types.ObjectId(authorId),
      content: content,
      createdAt: { $gte: timeWindow },
    };

    if (threadId) {
      query.threadId = new Types.ObjectId(threadId);
    }

    return this.messageModel.findOne(query).exec();
  }

  /**
   * Find a thread by sessionId stored in metadata
   */
  async findThreadBySessionId(
    sessionId: string,
    organizationId: string,
  ): Promise<ThreadDocument | null> {
    return this.threadModel
      .findOne({
        'metadata.sessionId': sessionId,
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
      })
      .exec();
  }

  /**
   * Get all messages for a thread
   */
  async getThreadMessages(
    threadId: string,
    organizationId: string,
    messageType?: MessageType,
  ): Promise<MessageDocument[]> {
    const query: any = {
      threadId: new Types.ObjectId(threadId),
      organizationId: new Types.ObjectId(organizationId),
    };

    if (messageType) {
      query.messageType = messageType;
    }

    const messages = await this.messageModel
      .find(query)
      .sort({ createdAt: 1 })
      .lean() // Use lean() to get plain objects
      .exec();

    // Manually populate authorId based on authorType
    const populatedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        this.logger.debug(
          `Processing message ${msg._id}: authorType=${msg.authorType}, authorId=${msg.authorId}`,
        );

        if (
          msg.authorType === 'user' ||
          msg.authorType === 'ai' ||
          msg.authorType === 'system'
        ) {
          // Populate from User collection
          const user = await this.messageModel.db.collection('users').findOne({
            _id: msg.authorId,
          });

          this.logger.debug(
            `Found user for message ${msg._id}: ${user ? `${user.firstName} ${user.lastName}` : 'NOT FOUND'}`,
          );

          if (user) {
            msg.authorId = user;
          }
        } else if (msg.authorType === 'customer') {
          // Populate from Customer collection
          const customer = await this.messageModel.db
            .collection('customers')
            .findOne({
              _id: msg.authorId,
            });

          this.logger.debug(
            `Found customer for message ${msg._id}: ${customer ? `${customer.firstName} ${customer.lastName}` : 'NOT FOUND'}`,
          );

          if (customer) {
            msg.authorId = customer;
          }
        }
        return msg;
      }),
    );

    return populatedMessages as any;
  }

  /**
   * Convert MessageChannel enum to channel name string for auto-reply
   */
  private getChannelName(channel: MessageChannel): string {
    switch (channel) {
      case MessageChannel.EMAIL:
        return 'email';
      case MessageChannel.WIDGET:
        return 'widget';
      case MessageChannel.WHATSAPP:
        return 'whatsapp';
      case MessageChannel.SMS:
        return 'sms';
      default:
        return 'email';
    }
  }
}
