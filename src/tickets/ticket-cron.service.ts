import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from './entities/ticket.entity';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/entities/organization.entity';
import { ThreadsService } from '../threads/threads.service';
import {
  MessageType,
  MessageAuthorType,
} from '../threads/entities/message.entity';
import { UserRole } from '../users/entities/user.entity';

import { ConfigService } from '@nestjs/config';
import { generateAutoCloseMessage } from '../ai/agents/response/auto-close';

@Injectable()
export class TicketCronService {
  private readonly logger = new Logger(TicketCronService.name);

  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Organization.name)
    private orgModel: Model<OrganizationDocument>,
    private threadsService: ThreadsService,
    private configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoClose() {
    this.logger.log(
      '[TicketCronService] Running auto-close check for inactive tickets...',
    );

    // 1. Get all organizations with auto-close enabled
    const orgs = await this.orgModel.find({ autoCloseEnabled: true }).exec();

    if (orgs.length === 0) {
      this.logger.debug(
        '[TicketCronService] No organizations have auto-close enabled.',
      );
      return;
    }

    for (const org of orgs) {
      const delayHours = org.autoCloseDelayHours || 72;
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - delayHours);

      // 2. Find tickets in 'pending' status that haven't been updated since cutoff
      const inactiveTickets = await this.ticketModel
        .find({
          organizationId: org._id,
          status: TicketStatus.PENDING,
          updatedAt: { $lt: cutoff },
        })
        .exec();

      if (inactiveTickets.length === 0) continue;

      this.logger.log(
        `[TicketCronService] Found ${inactiveTickets.length} inactive tickets for organization ${org.name} (${org._id})`,
      );

      for (const ticket of inactiveTickets) {
        try {
          // 3. Find the thread for this ticket
          const thread = await this.threadsService.findByTicket(
            ticket._id.toString(),
            org._id.toString(),
            org._id.toString(),
            UserRole.ADMIN,
          );

          if (thread) {
            // 4. Generate AI Closure Message for the customer
            const closureMessage = await generateAutoCloseMessage(
              ticket.displayId || ticket._id.toString(),
              ticket.subject || 'your ticket',
              this.configService,
            );

            // 5. Send EXTERNAL message to customer
            await this.threadsService.createMessage(
              thread._id.toString(),
              {
                content: closureMessage,
                messageType: MessageType.EXTERNAL,
              },
              org._id.toString(),
              org._id.toString(),
              UserRole.ADMIN,
              MessageAuthorType.AI,
            );

            // 6. Add INTERNAL note for audit
            await this.threadsService.createMessage(
              thread._id.toString(),
              {
                content: `Ticket automatically closed by system due to ${delayHours} hours of inactivity.`,
                messageType: MessageType.INTERNAL,
              },
              org._id.toString(),
              org._id.toString(),
              UserRole.ADMIN,
              MessageAuthorType.SYSTEM,
            );
          }

          // 7. Update ticket status to CLOSED
          await this.ticketModel.updateOne(
            { _id: ticket._id },
            {
              $set: {
                status: TicketStatus.CLOSED,
                resolvedAt: new Date(),
                resolutionType: 'ai',
              },
            },
          );

          this.logger.log(
            `[TicketCronService] Auto-closed ticket ${ticket.displayId || ticket._id}`,
          );
        } catch (err) {
          this.logger.error(
            `[TicketCronService] Failed to auto-close ticket ${ticket._id}: ${err.message}`,
          );
        }
      }
    }
  }
}
