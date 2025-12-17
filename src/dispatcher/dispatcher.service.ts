import { Injectable, Logger } from '@nestjs/common';
import { EmailIntegrationService } from '../integrations/email/email-integration.service';
import { MessageDocument, MessageType, MessageChannel } from '../threads/entities/message.entity';
import { TicketDocument } from '../tickets/entities/ticket.entity';
import { CustomersService } from '../customers/customers.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private emailIntegrationService: EmailIntegrationService,
    private customersService: CustomersService,
    private organizationsService: OrganizationsService,
  ) {}

  /**
   * Dispatch an outgoing message to the customer via the appropriate channel
   */
  async dispatch(
    message: MessageDocument,
    ticket: TicketDocument,
    recipientEmail: string, // Customer email
    inReplyTo?: string,
    references?: string,
  ): Promise<boolean> {
    try {
      this.logger.debug(`Dispatching message ${message._id} to ${recipientEmail}`);

      // We only handle EMAIL channel for now
      // Logic could be expanded for SMS/WhatsApp
      
      // Find the organization's connected email to send FROM
      // We need to know WHICH email integration this ticket belongs to.
      // Currently, we don't strictly link a ticket to an email integration, 
      // but we can look up if there is an integration for this organization.
      
      // For now, let's pick the FIRST active email integration for the organization.
      // In a multi-inbox setup, we would need to store `sourceInboxId` on the ticket.
      const integrations = await this.emailIntegrationService.findByOrganization(
        message.organizationId.toString(),
      );

      if (integrations.length === 0) {
        this.logger.warn(
          `No active email integration found for organization ${message.organizationId}`,
        );
        return false;
      }

      // If multiple, maybe try to match the "To" address of original email?
      // For MVP, just use the first one.
      const integration = integrations[0];
      const fromEmail = integration.email;

      // Prepare email content
      const subject = `Re: ${ticket.subject}`; // Simplistic subject handling
      
      // Threading headers are passed as parameters
      // inReplyTo and references should be the Message-ID from the last customer email
      // This ensures proper email threading in the customer's inbox
      
      // Calling sendEmail
      await this.emailIntegrationService.sendEmail(
        fromEmail,
        recipientEmail,
        subject,
        message.content,
        inReplyTo,
        references,
      );

      this.logger.log(`Dispatched message ${message._id} via ${fromEmail}`);
      return true;
    } catch (error) {
      this.logger.error(`Error dispatching message: ${error.message}`);
      return false;
    }
  }
}
