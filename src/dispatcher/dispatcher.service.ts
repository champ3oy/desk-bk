import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EmailIntegrationService } from '../integrations/email/email-integration.service';
import {
  MessageDocument,
  MessageType,
  MessageChannel,
  MessageAuthorType,
} from '../threads/entities/message.entity';
import { TicketDocument } from '../tickets/entities/ticket.entity';
import { CustomersService } from '../customers/customers.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import { marked } from 'marked';

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private emailIntegrationService: EmailIntegrationService,
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    private organizationsService: OrganizationsService,
    private usersService: UsersService,
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
      this.logger.debug(
        `Dispatching message ${message._id} to ${recipientEmail}`,
      );

      // We only handle EMAIL channel for now
      // Logic could be expanded for SMS/WhatsApp

      // Find the organization's connected email to send FROM
      // We need to know WHICH email integration this ticket belongs to.
      // Currently, we don't strictly link a ticket to an email integration,
      // but we can look up if there is an integration for this organization.

      // For now, let's pick the FIRST active email integration for the organization.
      // In a multi-inbox setup, we would need to store `sourceInboxId` on the ticket.
      const integrations =
        await this.emailIntegrationService.findByOrganization(
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

      // Convert Markdown to HTML
      let htmlContent = await marked.parse(message.content);

      // Append Human Agent Signature if applicable
      if (message.authorType === MessageAuthorType.USER) {
        try {
          // message.authorId is likely an ObjectId or string
          const userId =
            typeof message.authorId === 'object'
              ? (message.authorId as any)._id
                ? (message.authorId as any)._id.toString()
                : (message.authorId as any).toString()
              : (message.authorId as any).toString();

          this.logger.debug(
            `Dispatcher: Fetching user ${userId} for signature...`,
          );
          const user = (await this.usersService.findOne(userId)) as any;

          this.logger.debug(
            `Dispatcher: User loaded. Signature: ${JSON.stringify(
              user.signature,
            )}`,
          );

          if (user.signature?.enabled) {
            let signatureHtml = '';
            if (user.signature.text) {
              // Convert signature text to HTML if it's markdown
              const sigTextHtml = await marked.parse(user.signature.text);
              signatureHtml += sigTextHtml;
            }
            if (user.signature.imageUrl) {
              signatureHtml += `<br/><img src="${user.signature.imageUrl}" alt="${user.firstName} ${user.lastName}" style="max-width: 200px; height: auto;" />`;
            }

            if (signatureHtml) {
              htmlContent += `<br/><hr style="border: none; border-top: 1px solid #ccc; margin-top: 20px;"/><div class="signature">${signatureHtml}</div>`;
              this.logger.debug('Dispatcher: Signature appended.');
            }
          } else {
            this.logger.debug(
              'Dispatcher: Signature skipped (disabled or empty).',
            );
          }
        } catch (err) {
          this.logger.warn(
            `Failed to append signature for user ${message.authorId}: ${err.message}`,
          );
          // Continue delivering the message even if signature fails
        }
      }

      // Calling sendEmail
      await this.emailIntegrationService.sendEmail(
        fromEmail,
        recipientEmail,
        subject,
        htmlContent,
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
