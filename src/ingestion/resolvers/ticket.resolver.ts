import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import {
  Message,
  MessageDocument,
  MessageChannel,
} from '../../threads/entities/message.entity';
import { Thread, ThreadDocument } from '../../threads/entities/thread.entity';
import { TicketsService } from '../../tickets/tickets.service';
import {
  Ticket,
  TicketDocument,
  TicketStatus,
} from '../../tickets/entities/ticket.entity';

@Injectable()
export class TicketResolver {
  private readonly logger = new Logger(TicketResolver.name);

  // Statuses that are considered "open" for attaching new messages
  private readonly OPEN_STATUSES = [
    TicketStatus.OPEN,
    TicketStatus.PENDING,
    TicketStatus.ESCALATED,
    TicketStatus.IN_PROGRESS,
  ];

  constructor(
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(Thread.name)
    private threadModel: Model<ThreadDocument>,
    @InjectModel(Ticket.name)
    private ticketModel: Model<TicketDocument>,
    @Inject(forwardRef(() => TicketsService))
    private ticketsService: TicketsService,
  ) {}

  /**
   * Resolve if message is a reply to existing ticket or new ticket
   * Returns ticketId if reply, null if new ticket
   */
  async resolve(
    message: IncomingMessageDto,
    organizationId: string,
    customerId: string,
  ): Promise<string | null> {
    try {
      const orgId = new Types.ObjectId(organizationId);

      // Strategy 1: Check email headers (In-Reply-To, References)
      if (message.inReplyTo || message.references) {
        const messageId = message.inReplyTo || message.references;
        if (messageId) {
          const ticketId = await this.findTicketByMessageId(
            messageId,
            organizationId,
          );
          if (ticketId) {
            this.logger.debug(`Found reply ticket ${ticketId} by message ID`);
            return ticketId;
          }
        }
      }

      // Strategy 2: Check message ID in metadata
      if (message.messageId) {
        const ticketId = await this.findTicketByMessageId(
          message.messageId,
          organizationId,
        );
        if (ticketId) {
          this.logger.debug(
            `Found reply ticket ${ticketId} by message ID from metadata`,
          );
          return ticketId;
        }
      }

      // Strategy 3: Check Subject for Ticket ID Pattern
      // Pattern: [Ticket #12345] or Ticket #12345
      // We look for alphanumeric ID after "Ticket #"
      if (message.subject) {
        const ticketId = await this.findTicketBySubject(
          message.subject,
          organizationId,
        );
        if (ticketId) {
          this.logger.debug(`Found reply ticket ${ticketId} by Subject match`);
          return ticketId;
        }
      }

      // Strategy 4: Check thread ID (for SMS/WhatsApp/Widget)
      // This primarily checks for Session ID matches
      if (message.threadId) {
        const ticketId = await this.findTicketByThreadId(
          message.threadId,
          organizationId,
          // We don't pass customerId here to avoid the fallback logic inside findTicketByThreadId
          // We want to control the fallback logic explicitly in Step 5
          '',
          message.channel,
        );
        if (ticketId) {
          this.logger.debug(`Found reply ticket ${ticketId} by thread ID`);
          return ticketId;
        }
      }

      // Strategy 5: Fallback - Check for any OPEN ticket for this customer
      // This handles "continuous conversation" behavior for WhatsApp/SMS where users just send messages
      if (customerId) {
        const ticketId = await this.findMostRecentOpenTicket(
          customerId,
          organizationId,
        );
        if (ticketId) {
          this.logger.debug(
            `Found most recent open ticket ${ticketId} for customer ${customerId}`,
          );
          return ticketId;
        }
      }

      // No reply found - this is a new ticket
      this.logger.debug('No existing ticket found - treating as new ticket');
      return null;
    } catch (error) {
      this.logger.error(
        `Error resolving ticket: ${error.message}`,
        error.stack,
      );
      // On error, treat as new ticket to avoid losing messages
      return null;
    }
  }

  /**
   * Find ticket by external message ID (email Message-ID header)
   */
  private async findTicketByMessageId(
    messageId: string,
    organizationId: string,
  ): Promise<string | null> {
    if (!messageId) {
      return null;
    }

    // Normalize message ID (remove angle brackets if present)
    const normalizedId = messageId.replace(/^<|>$/g, '').trim();

    // Find message with this external message ID
    const message = await this.messageModel
      .findOne({
        externalMessageId: normalizedId,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();

    if (!message) {
      return null;
    }

    // Get thread for this message
    const thread = await this.threadModel
      .findOne({
        _id: message.threadId,
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
      })
      .exec();

    if (!thread) {
      return null;
    }

    return thread.ticketId.toString();
  }

  /**
   * Find ticket by thread/conversation ID (for SMS/WhatsApp)
   */
  private async findTicketByThreadId(
    threadId: string,
    organizationId: string,
    customerId: string,
    channel?: MessageChannel,
  ): Promise<string | null> {
    if (!threadId) {
      return null;
    }

    // Check strict match for widget session ID in metadata
    // or specific threadId provided by channel
    const threadBySession = await this.threadModel.findOne({
      'metadata.sessionId': threadId,
      organizationId: new Types.ObjectId(organizationId),
      isActive: true, // Only match valid/active threads
    });

    if (threadBySession) {
      this.logger.debug(
        `Found reply ticket ${threadBySession.ticketId} by session ID: ${threadId}`,
      );
      return threadBySession.ticketId.toString();
    }

    // For Widget channel, we strictly require the session ID to match if checking thread ID.
    if (channel === MessageChannel.WIDGET) {
      return null;
    }

    // Logic for finding open thread by Customer ID has been moved to findMostRecentOpenTicket
    // But we keep it here for backward compatibility if called internally with customerId
    if (customerId) {
      return this.findMostRecentOpenTicket(customerId, organizationId);
    }

    return null;
  }

  /**
   * Find the most recent OPEN ticket for a customer.
   * Used as fallback to maintain continuous conversation.
   */
  private async findMostRecentOpenTicket(
    customerId: string,
    organizationId: string,
  ): Promise<string | null> {
    try {
      // Find most recent active thread for this customer
      const threads = await this.threadModel
        .find({
          customerId: new Types.ObjectId(customerId),
          organizationId: new Types.ObjectId(organizationId),
          isActive: true,
        })
        .sort({ updatedAt: -1 })
        .limit(10) // Check last 10 threads just in case
        .exec();

      // Check each thread's ticket status - first open one wins
      for (const thread of threads) {
        const isOpen = await this.isTicketOpen(thread.ticketId.toString());
        if (isOpen) {
          return thread.ticketId.toString();
        }
      }

      // No open tickets found
      this.logger.debug(
        `No open tickets found for customer ${customerId} among recent threads`,
      );
      return null;
    } catch (error) {
      this.logger.warn(
        `Error searching for open tickets for customer ${customerId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Check if a ticket is in an "open" state (not closed/resolved)
   */
  private async isTicketOpen(ticketId: string): Promise<boolean> {
    try {
      const ticket = await this.ticketModel
        .findById(ticketId)
        .select('status')
        .lean()
        .exec();

      if (!ticket) {
        return false;
      }

      return this.OPEN_STATUSES.includes(ticket.status);
    } catch (error) {
      this.logger.warn(`Error checking ticket status: ${error.message}`);
      return false;
    }
  }

  /**
   * Find ticket by matching Subject pattern
   */
  private async findTicketBySubject(
    subject: string,
    organizationId: string,
  ): Promise<string | null> {
    if (!subject) return null;

    // Regex to match [Ticket #ID] or Ticket #ID (case insensitive)
    // Matches: [Ticket #507f1f...], Ticket #507f1f..., etc.
    // We assume ID is alphanumeric objectId or similar string
    const match = subject.match(
      /(?:\[|\s)Ticket\s*#([a-zA-Z0-9-]+)(?:\]|\s|$)/i,
    );

    if (match && match[1]) {
      const ticketIdCandidate = match[1];

      try {
        // 1. Try to find by displayId first
        const ticketByDisplayId = await this.ticketModel
          .findOne({
            displayId: ticketIdCandidate.toUpperCase(),
            organizationId: new Types.ObjectId(organizationId),
          })
          .exec();

        if (ticketByDisplayId) {
          return ticketByDisplayId._id.toString();
        }

        // 2. Try to find by ObjectId (legacy/fallback)
        if (Types.ObjectId.isValid(ticketIdCandidate)) {
          const thread = await this.threadModel
            .findOne({
              ticketId: new Types.ObjectId(ticketIdCandidate),
              organizationId: new Types.ObjectId(organizationId),
            })
            .exec();

          if (thread) {
            return thread.ticketId.toString();
          }
        }
      } catch (err) {
        this.logger.warn(`Error verifying ticket from subject: ${err.message}`);
      }
    }
    return null;
  }

  /**
   * Update ticket status when customer replies
   */
  async updateTicketOnReply(
    ticketId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      // Get ticket to check current status
      // We'll need to import TicketsService properly
      // For now, just log - the actual update can be done in the ingestion service
      this.logger.debug(
        `Customer replied to ticket ${ticketId} - status may need update`,
      );
    } catch (error) {
      this.logger.error(`Error updating ticket on reply: ${error.message}`);
    }
  }
}
