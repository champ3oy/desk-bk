import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EmailIntegrationService } from '../integrations/email/email-integration.service';
import { SocialIntegrationService } from '../integrations/social/social-integration.service'; // Ensure this import exists
import { WidgetGateway } from '../gateways/widget.gateway';
import { convert } from 'html-to-text';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Message,
  MessageDocument,
  MessageType,
  MessageChannel,
  MessageAuthorType,
} from '../threads/entities/message.entity';
import { Thread, ThreadDocument } from '../threads/entities/thread.entity';
import {
  SocialIntegration,
  SocialIntegrationDocument,
  SocialProvider,
  SocialIntegrationStatus,
} from '../integrations/social/entities/social-integration.entity';
import { TicketDocument } from '../tickets/entities/ticket.entity';
import { CustomersService } from '../customers/customers.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import * as marked from 'marked';

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private emailIntegrationService: EmailIntegrationService,
    private socialIntegrationService: SocialIntegrationService,
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    @Inject(forwardRef(() => WidgetGateway))
    private widgetGateway: WidgetGateway,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(Thread.name)
    private threadModel: Model<ThreadDocument>,
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
        `Dispatching message ${message._id} via channel ${message.channel} to ${recipientEmail}`,
      );

      if (message.channel === MessageChannel.WHATSAPP) {
        return await this.dispatchWhatsApp(message, ticket, recipientEmail);
      }

      if (message.channel === MessageChannel.WIDGET) {
        return await this.dispatchWidget(message, ticket);
      }

      if (message.channel === MessageChannel.WEBHOOK) {
        return await this.dispatchWebhook(message, ticket);
      }

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

      // Convert Markdown to HTML (avoid double parsing if already HTML)
      let htmlContent: string;
      const content = message.content || '';
      if (
        (content.includes('<p>') && content.includes('</p>')) ||
        (content.includes('<div') && content.includes('</div>')) ||
        content.includes('<br') ||
        content.includes('<img')
      ) {
        htmlContent = content;
      } else {
        htmlContent = await marked.parse(content);
      }

      // Append Attachments (images) to HTML body if they exist
      if (message.attachments && message.attachments.length > 0) {
        let attachmentsHtml =
          '<br/><div class="message-attachments" style="margin-top: 20px; border-top: 1px solid #eee; pt: 10px;">';
        let hasImages = false;

        message.attachments.forEach((att) => {
          if (!att.path || att.path === 'undefined') return;

          // Check if this attachment is already embedded in the HTML body
          if (htmlContent.includes(att.path)) return;

          if (att.mimeType?.startsWith('image/')) {
            hasImages = true;
            attachmentsHtml += `<div style="margin-bottom: 15px;">
              <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${att.originalName}</p>
              <img src="${att.path}" alt="${att.originalName}" style="max-width: 100%; border-radius: 8px; border: 1px solid #ddd;" />
            </div>`;
          } else {
            // For non-image files, just add a link
            attachmentsHtml += `<div style="margin-bottom: 5px;">
              <p style="font-size: 12px; color: #666;">
                📎 <a href="${att.path}" target="_blank" style="color: #06b6d4; text-decoration: none;">${att.originalName}</a> (${(att.size / 1024).toFixed(1)} KB)
              </p>
            </div>`;
          }
        });

        attachmentsHtml += '</div>';
        if (hasImages || message.attachments.length > 0) {
          htmlContent += attachmentsHtml;
        }
      }

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
              // Enable breaks to render newlines as <br>
              const sigTextHtml = await marked.parse(user.signature.text, {
                breaks: true,
              });
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
      const externalMessageId = await this.emailIntegrationService.sendEmail(
        fromEmail,
        recipientEmail,
        subject,
        htmlContent,
        inReplyTo,
        references,
      );

      if (externalMessageId) {
        message.externalMessageId = externalMessageId;
        await message.save();
      }

      this.logger.log(`Dispatched message ${message._id} via ${fromEmail}`);
      return true;
    } catch (error) {
      this.logger.error(`Error dispatching message: ${error.message}`);
      return false;
    }
  }

  /**
   * Dispatch a message via WhatsApp
   */
  /**
   * Dispatch a message via WhatsApp
   */
  private async dispatchWhatsApp(
    message: MessageDocument,
    ticket: TicketDocument,
    recipientEmail: string,
  ): Promise<boolean> {
    try {
      const organizationId = message.organizationId.toString();

      // Find active WhatsApp integration
      const integrations = await this.socialIntegrationService.findByProvider(
        organizationId,
        SocialProvider.WHATSAPP,
      );

      const integration = integrations.find((i) => i.isActive);

      if (!integration) {
        this.logger.warn(
          `No active WhatsApp integration found for organization ${organizationId}`,
        );
        return false;
      }

      // Get customer phone number
      // Handle both populated and unpopulated customerId
      const customerIdString =
        typeof ticket.customerId === 'object' && (ticket.customerId as any)._id
          ? (ticket.customerId as any)._id.toString()
          : ticket.customerId.toString();

      const customer = await this.customersService.findOne(
        customerIdString,
        organizationId,
      );

      const to = customer.phone;
      if (!to) {
        this.logger.warn(
          `Cannot send WhatsApp: Customer ${customer._id} has no phone number`,
          JSON.stringify(customer),
        );
        return false;
      }

      // Convert HTML to plain text
      const plainContent = convert(message.content, {
        wordwrap: false,
      });

      // Check for attachments
      let attachment:
        | {
            url: string;
            type: 'image' | 'video' | 'document' | 'audio';
            filename?: string;
          }
        | undefined;

      if (message.attachments && message.attachments.length > 0) {
        const att = message.attachments[0]; // WhatsApp only supports 1 media per message usually
        if (att.path && att.path !== 'undefined') {
          let type: 'image' | 'video' | 'document' | 'audio' = 'document';
          if (att.mimeType?.startsWith('image/')) type = 'image';
          else if (att.mimeType?.startsWith('video/')) type = 'video';
          else if (att.mimeType?.startsWith('audio/')) type = 'audio';

          attachment = {
            url: att.path,
            type,
            filename: att.originalName,
          };
        }
      }

      // Send via WhatsApp service
      const externalMessageId =
        await this.socialIntegrationService.sendWhatsAppMessage(
          integration,
          to,
          plainContent,
          attachment,
        );

      if (externalMessageId) {
        message.externalMessageId = externalMessageId;
        await message.save();
      }

      this.logger.log(`Dispatched WhatsApp message ${message._id} to ${to}`);
      return true;
    } catch (error) {
      this.logger.error(`Error dispatching WhatsApp message: ${error.message}`);
      return false;
    }
  }

  /**
   * Dispatch message via Live Chat Widget
   */
  private async dispatchWidget(
    message: MessageDocument,
    ticket: TicketDocument,
  ): Promise<boolean> {
    try {
      this.logger.debug(`Dispatching widget message for ticket ${ticket._id}`);

      // Convert HTML to plain text for widget if needed (as requested by user)
      // Note: we use this to ensure consistent plain text delivery to simple widgets
      const plainContent = convert(message.content, {
        wordwrap: false,
      });

      // Find the thread to get sessionId
      const thread = await this.threadModel.findById(message.threadId);

      if (thread && thread.metadata?.sessionId) {
        // Extract the organizationId correctly, handling both populated and unpopulated cases
        const orgId =
          typeof ticket.organizationId === 'object' &&
          (ticket.organizationId as any)._id
            ? (ticket.organizationId as any)._id.toString()
            : ticket.organizationId.toString();

        this.logger.debug(
          `Found sessionId ${thread.metadata.sessionId} for room ${orgId}:${thread.metadata.sessionId}`,
        );
        // We need to pass the "text" version to the gateway
        // But the gateway's sendNewMessage also does its own convert.
        // To be safe and fulfill the request of having it in the dispatcher, we do it here.
        // We wrap it in a plain object that gateway expects or modify gateway later.
        this.widgetGateway.sendNewMessage(orgId, thread.metadata.sessionId, {
          ...message.toObject(),
          content: plainContent, // Pass the converted content
        });
        return true;
      }

      this.logger.warn(
        `No active session found for widget thread ${message.threadId}. Metadata: ${JSON.stringify(thread?.metadata || {})}`,
      );
      return false;
    } catch (error) {
      this.logger.error(`Failed to dispatch widget message: ${error.message}`);
      return false;
    }
  }

  /**
   * Dispatch message via generic Webhook
   */
  private async dispatchWebhook(
    message: MessageDocument,
    ticket: TicketDocument,
  ): Promise<boolean> {
    try {
      this.logger.debug(`Dispatching webhook message for ticket ${ticket._id}`);

      // Convert HTML to plain text
      const plainContent = convert(message.content, {
        wordwrap: false,
      });

      // This is a placeholder for actual webhook logic (e.g. POST to a URL)
      this.logger.log(
        `[Webhook Dispatcher] (NOT IMPLEMENTED) Sending message to webhook: ${plainContent.substring(0, 50)}...`,
      );

      return true;
    } catch (error) {
      this.logger.error(`Failed to dispatch webhook message: ${error.message}`);
      return false;
    }
  }
}
