import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { CustomersService } from '../../customers/customers.service';
import { IncomingMessageDto } from '../dto/incoming-message.dto';

@Injectable()
export class CustomerResolver {
  private readonly logger = new Logger(CustomerResolver.name);

  constructor(
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
  ) {}

  /**
   * Resolve customer from incoming message
   * Uses findOrCreate to get or create customer
   */
  async resolve(
    message: IncomingMessageDto,
    organizationId: string,
  ): Promise<string> {
    try {
      // Extract customer data from message
      const customerData: {
        email?: string;
        phone?: string;
        firstName?: string;
        lastName?: string;
        company?: string;
        externalId?: string;
      } = {};

      if (message.senderEmail) {
        customerData.email = message.senderEmail;
      }

      if (message.senderPhone) {
        customerData.phone = message.senderPhone;
      }

      // Parse name from senderName
      if (message.senderName) {
        const nameParts = this.parseName(message.senderName);
        customerData.firstName = nameParts.firstName;
        customerData.lastName = nameParts.lastName;
      }

      // For widget messages, use sessionId as externalId
      if (message.metadata?.sessionId) {
        customerData.externalId = message.metadata.sessionId;
      }

      // For WhatsApp/SMS messages without email, use phone as externalId
      // This ensures consistent customer identification across conversations
      if (
        !customerData.email &&
        !customerData.externalId &&
        customerData.phone
      ) {
        customerData.externalId = `phone:${customerData.phone}`;
      }

      // Find or create customer
      const customer = await this.customersService.findOrCreate(
        customerData,
        organizationId,
      );

      this.logger.debug(
        `Resolved customer ${customer._id} for organization ${organizationId}`,
      );
      return customer._id.toString();
    } catch (error) {
      this.logger.error(
        `Error resolving customer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Parse full name into first and last name
   */
  private parseName(fullName: string): { firstName: string; lastName: string } {
    if (!fullName) {
      return { firstName: 'Customer', lastName: '' };
    }

    const trimmed = fullName.trim();
    const parts = trimmed.split(/\s+/);

    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' };
    }

    if (parts.length === 2) {
      return { firstName: parts[0], lastName: parts[1] };
    }

    // More than 2 parts - first is first name, rest is last name
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    };
  }
}
