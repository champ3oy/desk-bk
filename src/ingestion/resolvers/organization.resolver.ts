import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OrganizationsService } from '../../organizations/organizations.service';
import { OrganizationDocument } from '../../organizations/entities/organization.entity';
import { IncomingMessageDto } from '../dto/incoming-message.dto';
import { SocialIntegrationService } from '../../integrations/social/social-integration.service';
import { EmailIntegrationService } from '../../integrations/email/email-integration.service';
import { MessageChannel } from '../../threads/entities/message.entity';

@Injectable()
export class OrganizationResolver {
  private readonly logger = new Logger(OrganizationResolver.name);

  constructor(
    private organizationsService: OrganizationsService,
    private socialIntegrationService: SocialIntegrationService,
    @Inject(forwardRef(() => EmailIntegrationService))
    private emailIntegrationService: EmailIntegrationService,
  ) {}

  /**
   * Resolve organization from incoming message
   * Matches by recipient email or phone number
   */
  async resolve(message: IncomingMessageDto): Promise<string | null> {
    try {
      // Get all organizations
      const organizations = await this.organizationsService.findAll();

      // Try to match by recipient email
      if (message.recipientEmail) {
        const normalizedRecipient = message.recipientEmail.toLowerCase().trim();

        for (const org of organizations as OrganizationDocument[]) {
          if (!org.isActive) {
            continue;
          }

          // Check primary support email
          if (
            org.supportEmail &&
            org.supportEmail.toLowerCase().trim() === normalizedRecipient
          ) {
            this.logger.debug(
              `Matched organization ${(org as any)._id} by support email`,
            );
            return (org as any)._id.toString();
          }

          // Check additional emails
          if (org.additionalEmails && org.additionalEmails.length > 0) {
            const match = org.additionalEmails.some(
              (email) => email.toLowerCase().trim() === normalizedRecipient,
            );
            if (match) {
              this.logger.debug(
                `Matched organization ${(org as any)._id} by additional email`,
              );
              return (org as any)._id.toString();
            }
          }

          // Check Email Integrations (Fuzzy match fallback)
          try {
            const orgId = (org as any)._id.toString();
            const emailIntegrations =
              await this.emailIntegrationService.findByOrganization(orgId);

            const match = emailIntegrations.find((ei) => {
              return (
                ei.isActive &&
                ei.email.toLowerCase().trim() === normalizedRecipient
              );
            });

            if (match) {
              this.logger.debug(
                `Matched organization ${orgId} by Email Integration ${match.email}`,
              );
              message.integrationId = (match as any)._id.toString();
              return orgId;
            }
          } catch (e) {}
        }
      }

      // Try to match by recipient phone
      if (message.recipientPhone) {
        const normalizedRecipient = this.normalizePhone(message.recipientPhone);

        for (const org of organizations as OrganizationDocument[]) {
          if (!org.isActive) {
            continue;
          }

          // Check primary support phone
          if (
            org.supportPhone &&
            this.normalizePhone(org.supportPhone) === normalizedRecipient
          ) {
            this.logger.debug(
              `Matched organization ${(org as any)._id} by support phone`,
            );
            return (org as any)._id.toString();
          }

          // Check additional phones
          if (org.additionalPhones && org.additionalPhones.length > 0) {
            const match = org.additionalPhones.some(
              (phone) => this.normalizePhone(phone) === normalizedRecipient,
            );
            if (match) {
              this.logger.debug(
                `Matched organization ${(org as any)._id} by additional phone`,
              );
              return (org as any)._id.toString();
            }
          }
        }

        // Check Social Integrations (WhatsApp phone numbers)
        // This is useful if the phone number is connected via API but not manually added to org settings
        try {
          // Since we already have all organizations, we can just check if any has a matching WhatsApp integration
          // For better performance, we'd query directly, but let's keep it simple for now
          // We'll iterate through all organizations and their social integrations

          // Also check by phoneNumberId if available in metadata (Meta API ID)
          const phoneNumberId = message.metadata?.phoneNumberId;

          for (const org of organizations as OrganizationDocument[]) {
            const orgId = (org as any)._id.toString();
            const integrations =
              await this.socialIntegrationService.findByOrganization(orgId);

            const match = integrations.some((integration) => {
              if (!integration.isActive) return false;

              // Match by phone number
              if (
                integration.phoneNumber &&
                this.normalizePhone(integration.phoneNumber) ===
                  normalizedRecipient
              ) {
                return true;
              }

              // Match by phoneNumberId (Meta API ID)
              if (
                phoneNumberId &&
                integration.phoneNumberId === phoneNumberId
              ) {
                return true;
              }

              return false;
            });

            const matchingIntegration = match
              ? integrations.find((i) => {
                  if (!i.isActive) return false;
                  if (
                    i.phoneNumber &&
                    this.normalizePhone(i.phoneNumber) === normalizedRecipient
                  )
                    return true;
                  if (phoneNumberId && i.phoneNumberId === phoneNumberId)
                    return true;
                  return false;
                })
              : null;

            if (match && matchingIntegration) {
              this.logger.debug(
                `Matched organization ${orgId} by Social Integration phone/phoneNumberId`,
              );
              message.integrationId = (
                matchingIntegration as any
              )._id.toString();
              return orgId;
            }
          }
        } catch (error) {
          this.logger.warn(
            `Error checking social integrations for org resolve: ${error.message}`,
          );
        }
      }

      this.logger.warn(
        `Could not resolve organization for message: recipientEmail=${message.recipientEmail}, recipientPhone=${message.recipientPhone}`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Error resolving organization: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Normalize phone number for comparison
   */
  private normalizePhone(phone: string): string {
    if (!phone) {
      return '';
    }
    // Remove spaces, dashes, parentheses, and convert to lowercase
    return phone.replace(/\s|-|\(|\)/g, '').toLowerCase();
  }
}
