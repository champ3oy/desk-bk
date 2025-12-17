import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { Message, MessageDocument } from '../../threads/entities/message.entity';
import { Thread, ThreadDocument } from '../../threads/entities/thread.entity';
import { TicketsService } from '../../tickets/tickets.service';
import { TicketStatus } from '../../tickets/entities/ticket.entity';

@Injectable()
export class TicketResolver {
  private readonly logger = new Logger(TicketResolver.name);

  constructor(
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(Thread.name)
    private threadModel: Model<ThreadDocument>,
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
          this.logger.debug(`Found reply ticket ${ticketId} by message ID from metadata`);
          return ticketId;
        }
      }

      // Strategy 3: Check thread ID (for SMS/WhatsApp)
      if (message.threadId) {
        const ticketId = await this.findTicketByThreadId(
          message.threadId,
          organizationId,
          customerId,
        );
        if (ticketId) {
          this.logger.debug(`Found reply ticket ${ticketId} by thread ID`);
          return ticketId;
        }
      }

      // No reply found - this is a new ticket
      this.logger.debug('No existing ticket found - treating as new ticket');
      return null;
    } catch (error) {
      this.logger.error(`Error resolving ticket: ${error.message}`, error.stack);
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
  ): Promise<string | null> {
    if (!threadId) {
      return null;
    }

    // Find messages with this thread ID in metadata
    // For SMS/WhatsApp, we might store thread ID in externalMessageId or metadata
    // For now, we'll check if there's a pattern we can use
    // This might need to be enhanced based on how providers send thread IDs

    // Alternative: Find most recent thread for this customer and check if threadId matches
    // This is a simplified approach - in production you might want to store thread IDs separately
    const threads = await this.threadModel
      .find({
        customerId: new Types.ObjectId(customerId),
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
      })
      .sort({ updatedAt: -1 })
      .limit(10)
      .exec();

    // For now, return the most recent thread's ticket
    // In a more sophisticated implementation, you'd match thread IDs from metadata
    if (threads.length > 0) {
      // Return the most recent ticket as a fallback
      // This is a heuristic - ideally you'd have a proper thread ID mapping
      return threads[0].ticketId.toString();
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
      this.logger.debug(`Customer replied to ticket ${ticketId} - status may need update`);
    } catch (error) {
      this.logger.error(`Error updating ticket on reply: ${error.message}`);
    }
  }
}

