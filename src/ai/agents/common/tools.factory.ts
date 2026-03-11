import { z } from 'zod';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { KnowledgeBaseService } from '../../knowledge-base.service';
import { CustomersService } from '../../../customers/customers.service';
import {
  TicketStatus,
  TicketPriority,
} from '../../../tickets/entities/ticket.entity';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: any;
  func: (args: any) => Promise<any>;
  enabledForOrgs?: string[];
  requiredKeywords?: string[];
}

export function getAgentTools(params: {
  organizationId: string;
  userId: string;
  userRole: any;
  ticket?: any;
  customerId?: string; // Explicitly pass customerId for playground
  ticketsService: TicketsService;
  threadsService: ThreadsService;
  knowledgeBaseService: KnowledgeBaseService;
  customersService: CustomersService;
  channel?: string;
}): ToolDefinition[] {
  const {
    organizationId,
    userId,
    userRole,
    ticket,
    customerId: explicitCustomerId,
    ticketsService,
    threadsService,
    knowledgeBaseService,
    customersService,
    channel,
  } = params;

  // Resolve customerId from either ticket or explicit ID
  const effectiveCustomerId =
    explicitCustomerId ||
    (ticket
      ? (ticket.customerId as any)._id?.toString() ||
        ticket.customerId.toString()
      : null);

  return [
    {
      name: 'search_knowledge_base',
      description:
        'Search the internal knowledge base for policies, how-to guides, and troubleshooting steps.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'The search query (e.g., "refund policy", "reset password")',
          ),
      }),
      func: async ({ query }: { query: string }) => {
        try {
          if (!knowledgeBaseService) return 'Knowledge Base not available.';
          console.log(`[Tool] Searching KB: ${query}`);
          const results = await knowledgeBaseService.retrieveRelevantContent(
            query,
            organizationId,
            2,
          );
          return results || 'No relevant results found.';
        } catch (error) {
          console.error(`[Tool] Error searching KB:`, error);
          return `Error searching Knowledge Base: ${error.message}. Please try again or escalate if needed.`;
        }
      },
    },
    {
      name: 'get_customer_context',
      description:
        'Get details about the customer (email, name, phone, company).',
      schema: z.object({}), // No args needed, implied from context
      func: async () => {
        console.log(`[Tool] Getting customer context`);
        if (!effectiveCustomerId || !customersService)
          return 'Customer info unavailable.';
        const customer = await customersService.findOne(
          effectiveCustomerId,
          organizationId,
        );
        return JSON.stringify({
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: customer.phone,
          company: customer.company,
          externalId: customer.externalId,
        });
      },
    },
    {
      name: 'update_ticket_attributes',
      description:
        'Update ticket priority, status, or tags. Use this to organize the ticket.',
      schema: z.object({
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        tags: z.array(z.string()).optional(),
      }),
      func: async ({
        priority,
        tags,
      }: {
        priority?: string;
        tags?: string[];
      }) => {
        if (!ticket) return 'No ticket context available to update.';
        console.log(`[Tool] Updating ticket attributes`);
        const updateData: any = {};

        // Normalization for priority
        if (priority) {
          const p = priority.toLowerCase();
          if (['low', 'medium', 'high', 'urgent'].includes(p)) {
            updateData.priority = p;
          } else {
            console.warn(`[Tool] Invalid priority input: ${priority}`);
          }
        }

        // Tags logic
        if (tags && tags.length > 0) {
          const tagIds = await ticketsService.resolveTags(tags, organizationId);
          if (tagIds && tagIds.length > 0) {
            updateData.tagIds = tagIds.map((id) => id.toString());
          } else {
            console.warn(`[Tool] No valid tags found for input: ${tags}`);
          }
        }

        if (Object.keys(updateData).length > 0) {
          await ticketsService.update(
            ticket._id.toString(),
            updateData,
            userId,
            userRole,
            organizationId,
          );
          return 'Ticket updated successfully.';
        }
        return 'No updates applied.';
      },
    },
    {
      name: 'escalate_ticket',
      description:
        'Escalate the ticket to a human agent. Use this if you cannot solve the issue.',
      schema: z.object({
        reason: z.string().describe('Reason for escalation (internal logging)'),
        summary: z
          .string()
          .describe(
            'A brief summary of the user issue for the human agent (e.g. "User asking for refund on order #123")',
          ),
      }),
      func: async ({
        reason,
        summary,
      }: {
        reason: string;
        summary: string;
      }) => {
        console.log(`[Tool] Escalating ticket: ${reason}`);
        return { __action: 'ESCALATE', reason, summary };
      },
    },
    {
      name: 'send_final_reply',
      description: 'Send the final response to the user.',
      schema: z.object({
        message: z.string().describe('The message content to send.'),
      }),
      func: async ({ message }: { message: string }) => {
        console.log(`[Tool] Sending final reply`);
        return { __action: 'REPLY', message };
      },
    },
    {
      name: 'create_new_ticket',
      description: 'Create a NEW ticket for a separate issue.',
      schema: z.object({
        subject: z.string(),
        description: z.string(),
      }),
      func: async ({
        subject,
        description,
      }: {
        subject: string;
        description: string;
      }) => {
        console.log(`[Tool] Creating new ticket: ${subject}`);
        if (!effectiveCustomerId)
          return 'No customer associated with current session.';

        const newTicket = await ticketsService.create(
          {
            subject,
            description,
            status: TicketStatus.OPEN,
            customerId: effectiveCustomerId,
            priority: TicketPriority.MEDIUM,
          },
          organizationId,
          channel,
        );
        return {
          __action: 'REPLY',
          message: `I've created a new ticket (#${(newTicket as any).displayId}) for "${subject}".`,
        };
      },
    },
    {
      name: 'ask_customer_for_clarification',
      description:
        'Ask the customer for more information or clarification when you are stuck or missing details needed to help them.',
      schema: z.object({
        question: z
          .string()
          .describe(
            'The specific question or request for info to send to the customer.',
          ),
      }),
      func: async ({ question }: { question: string }) => {
        console.log(`[Tool] Asking for clarification`);
        return { __action: 'REPLY', message: question };
      },
    },
    {
      name: 'check_kyc_status',
      description:
        'Check the KYC (Know Your Customer) and account creation status for a user by their email address.',
      enabledForOrgs: ['69728f2ac84f3520beda91c3'],
      requiredKeywords: ['kyc', 'verification', 'id check'],
      schema: z.object({
        email: z
          .string()
          .email()
          .describe('The email address of the user to check.'),
      }),
      func: async ({ email }: { email: string }) => {
        try {
          console.log(`[Tool] Checking KYC for: ${email}`);
          const response = await fetch(
            `https://kyc-pipeline.blackstargroup.ai/api/v1/kyc/result?email=${encodeURIComponent(
              email,
            )}`,
          );
          if (!response.ok) {
            return `Failed to fetch KYC status for ${email}. Status: ${response.status}`;
          }
          const data = await response.json();
          return JSON.stringify(data);
        } catch (error) {
          console.error(`[Tool] Error checking KYC:`, error);
          return `Error checking KYC status: ${error.message}`;
        }
      },
    },
  ];
}
