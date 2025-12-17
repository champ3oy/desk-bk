import { Injectable, Logger } from '@nestjs/common';
import { OrganizationsService } from '../../organizations/organizations.service';
import { OrganizationDocument } from '../../organizations/entities/organization.entity';
import { IncomingMessageDto } from '../dto/incoming-message.dto';

@Injectable()
export class OrganizationResolver {
  private readonly logger = new Logger(OrganizationResolver.name);

  constructor(private organizationsService: OrganizationsService) {}

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
          if (org.supportEmail && org.supportEmail.toLowerCase().trim() === normalizedRecipient) {
            this.logger.debug(`Matched organization ${(org as any)._id} by support email`);
            return (org as any)._id.toString();
          }

          // Check additional emails
          if (org.additionalEmails && org.additionalEmails.length > 0) {
            const match = org.additionalEmails.some(
              (email) => email.toLowerCase().trim() === normalizedRecipient,
            );
            if (match) {
              this.logger.debug(`Matched organization ${(org as any)._id} by additional email`);
              return (org as any)._id.toString();
            }
          }
          
          // Also check integration emails linked to this organization
          // We can't easily join them here efficiently without circular deps or complex queries
          // But for now, let's assume if the organization has an active integration with this email, it belongs to them.
          // Or better: The Ingestion Service should technically pass the organization ID if known?
          // No, Ingestion Service finds it via Resolver.
          
          // Solution: We need to know which organization owns the integration.
          // BUT: The resolver doesn't know about integrations table yet.
          // Let's inject EmailIntegrationService or query integrations collection directly?
          // To avoid circular refs, let's just query the organizations service for integrations? 
          // No, EmailIntegration is separate module.
          
          // ALTERNATIVE: OrganizationResolver could rely on a mapping passed in?
          // NO. It should query.
          // Let's use a "fuzzy" or "direct" match if we passed organizationId? 
          // Wait, we don't know the organizationId yet. That IS the goal.
          
          // Hack/Fix: Since we connected the email "akotosel6@gmail.com", we must ensure that email is listed in `additionalEmails` or `supportEmail` of the Org.
          // OR we make the resolver smart enough to look up EmailIntegrations.
          // Let's make the resolver look up EmailIntegrations.
          
          // HOWEVER, existing code only checks org.supportEmail and org.additionalEmails.
          // We need to UPDATE the organization with this email when integration is added? 
          // OR check integrations.

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
          if (org.supportPhone && this.normalizePhone(org.supportPhone) === normalizedRecipient) {
            this.logger.debug(`Matched organization ${(org as any)._id} by support phone`);
            return (org as any)._id.toString();
          }

          // Check additional phones
          if (org.additionalPhones && org.additionalPhones.length > 0) {
            const match = org.additionalPhones.some(
              (phone) => this.normalizePhone(phone) === normalizedRecipient,
            );
            if (match) {
              this.logger.debug(`Matched organization ${(org as any)._id} by additional phone`);
              return (org as any)._id.toString();
            }
          }
        }
      }

      this.logger.warn(
        `Could not resolve organization for message: recipientEmail=${message.recipientEmail}, recipientPhone=${message.recipientPhone}`,
      );
      return null;
    } catch (error) {
      this.logger.error(`Error resolving organization: ${error.message}`, error.stack);
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

