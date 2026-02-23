import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { TicketsService } from '../tickets.service';
import { ThreadsService } from '../../threads/threads.service';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../../organizations/organizations.service';
import { KnowledgeBaseService } from '../../ai/knowledge-base.service';
import { CustomersService } from '../../customers/customers.service';
import { RedisLockService } from '../../common/services/redis-lock.service';
import { SocialIntegrationService } from '../../integrations/social/social-integration.service';
import { WidgetGateway } from '../../gateways/widget.gateway';
import { SmartCacheService } from '../../ai/smart-cache.service';

import { draftResponse } from '../../ai/agents/response';
import { TicketStatus } from '../entities/ticket.entity';
import { UserRole } from '../../users/entities/user.entity';
import { AIModelFactory } from '../../ai/ai-model.factory';
import {
  MessageType,
  MessageChannel,
  MessageAuthorType,
} from '../../threads/entities/message.entity';
import { runWithTelemetryContext } from '../../ai/telemetry/telemetry.context';

@Processor('ai-reply')
export class AiReplyProcessor extends WorkerHost {
  private readonly logger = new Logger(AiReplyProcessor.name);

  constructor(
    private ticketsService: TicketsService,
    @Inject(forwardRef(() => ThreadsService))
    private threadsService: ThreadsService,
    private configService: ConfigService,
    private organizationsService: OrganizationsService,
    @Inject(forwardRef(() => KnowledgeBaseService))
    private knowledgeBaseService: KnowledgeBaseService,
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    @Inject(forwardRef(() => SocialIntegrationService))
    private socialIntegrationService: SocialIntegrationService,
    private redisLockService: RedisLockService,
    @Inject(forwardRef(() => WidgetGateway))
    private widgetGateway: WidgetGateway,
    @Inject(forwardRef(() => SmartCacheService))
    private smartCacheService: SmartCacheService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<void> {
    const { ticketId, messageContent, organizationId, customerId, channel } =
      job.data;
    const lockKey = `job:${job.name}:${ticketId}`;

    try {
      this.logger.log(
        `[AiReplyProcessor] Processing job ${job.name} for ticket ${ticketId}`,
      );

      // Acquire Lock
      const locked = await this.redisLockService.acquireLock(lockKey, 60);
      if (!locked) {
        this.logger.warn(
          `[AiReplyProcessor] Skipped job ${job.name} for ticket ${ticketId} - Locked`,
        );
        return;
      }

      try {
        await runWithTelemetryContext(
          {
            organizationId: organizationId,
            ticketId: ticketId,
            feature: `auto-reply:${job.name}`,
          },
          async () => {
            switch (job.name) {
              case 'generate-reply':
                await this.handleGenerateReply(job.data);
                break;
              case 'send-intervention':
                await this.handleSendIntervention(job.data);
                break;
              case 'send-escalation-notice':
                await this.handleSendEscalationNotice(job.data);
                break;
              default:
                this.logger.warn(`Unknown job name: ${job.name}`);
            }
          },
        );
      } finally {
        await this.redisLockService.releaseLock(lockKey);
      }
    } catch (e) {
      this.logger.error(
        `Failed to process AI job ${job.name} for ${ticketId}. Error: ${e.message}`,
        e.stack,
      );
      // Re-throw to allow BullMQ retry logic to kick in
      throw e;
    }
  }

  private async handleGenerateReply(data: any): Promise<void> {
    const { ticketId, organizationId, customerId, channel } = data;

    const org = await this.organizationsService.findOne(organizationId);
    if (!org) return;

    const ticket = await this.ticketsService.findOne(
      ticketId,
      organizationId,
      UserRole.ADMIN,
      organizationId,
    );
    if (!ticket) return;

    // Set processing flag
    await this.ticketsService.update(
      ticketId,
      { isAiProcessing: true } as any,
      organizationId,
      UserRole.ADMIN,
      organizationId,
    );

    // Trigger Typing Indicator logic
    if (channel?.toLowerCase() === 'whatsapp') {
      try {
        const customer = await this.customersService.findOne(
          customerId,
          organizationId,
        );
        if (customer && customer.phone) {
          // Fetch last message to get externalMessageId for typing indicator (new API requirement)
          let lastExternalMessageId: string | undefined;
          try {
            const thread = await this.threadsService.findByTicket(
              ticketId,
              organizationId,
              organizationId,
              UserRole.ADMIN,
            );
            if (thread) {
              const lastMsg =
                await this.threadsService.findLatestExternalMessage(
                  thread._id.toString(),
                  organizationId,
                );
              lastExternalMessageId = lastMsg?.externalMessageId;
            }
          } catch (e) {
            console.warn(
              `[AiReplyProcessor] Failed to fetch last message for typing indicator: ${e.message}`,
            );
          }

          console.log(
            `[AiReplyProcessor] Sending typing indicator to ${customer.phone}, MessageID: ${lastExternalMessageId}`,
          );
          this.socialIntegrationService
            .sendWhatsAppTypingStatus(
              organizationId,
              customer.phone,
              'typing_on',
              lastExternalMessageId,
            )
            .catch((e) =>
              console.warn(`Failed to send typing status: ${e.message}`),
            );
        }
      } catch (e) {
        console.warn(
          `[AiReplyProcessor] Failed to process typing indicator: ${e.message}`,
        );
      }
    } else if (
      channel?.toLowerCase() === 'widget' ||
      channel?.toLowerCase() === 'chat'
    ) {
      // Trigger Typing Indicator logic (Widget)
      try {
        const customer = await this.customersService.findOne(
          customerId,
          organizationId,
        );
        // For widget, we need the sessionId (stored as externalId in this context usually)
        // Or we can rely on the ticket metadata if we stored the sessionId there
        if (customer && customer.externalId) {
          this.widgetGateway.sendTypingIndicator(
            organizationId,
            customer.externalId,
            true,
          );
        }
      } catch (e) {
        console.warn(
          `[AiReplyProcessor] Failed to process widget typing indicator: ${e.message}`,
        );
      }
    }

    try {
      console.log(`[AutoReply] Drafting response for ${ticketId}...`);
      const response = await draftResponse(
        ticketId,
        this.ticketsService,
        this.threadsService,
        this.configService,
        this.organizationsService,
        this.knowledgeBaseService,
        this.customersService,
        customerId,
        UserRole.ADMIN,
        organizationId,
        this.smartCacheService,
        undefined,
        channel,
        ticket.isWaitingForNewTopicCheck,
      );

      const confidence = response.confidence || 0;
      const threshold = org.aiConfidenceThreshold || 60;

      if (response.action === 'AUTO_RESOLVE') {
        this.logger.log(
          `[AiReplyProcessor] Auto-resolving ticket ${ticketId} due to gratitude/closure intent`,
        );

        await this.ticketsService.update(
          ticketId,
          {
            status: TicketStatus.RESOLVED,
            resolvedAt: new Date(),
            resolutionType: 'ai',
          } as any,
          organizationId,
          UserRole.ADMIN,
          organizationId,
        );

        // Add an internal note about the auto-resolution
        const thread = await this.threadsService.getOrCreateThread(
          ticketId,
          customerId,
          organizationId,
        );

        await this.threadsService.createMessage(
          thread._id.toString(),
          {
            content: `Ticket automatically resolved by Morpheus based on customer gratitude/closure message.`,
            messageType: MessageType.INTERNAL,
          },
          organizationId,
          organizationId,
          UserRole.ADMIN,
          MessageAuthorType.SYSTEM,
        );

        // Stop typing indicator
        if (
          channel?.toLowerCase() === 'widget' ||
          channel?.toLowerCase() === 'chat'
        ) {
          const customer = await this.customersService.findOne(
            customerId,
            organizationId,
          );
          if (customer?.externalId) {
            this.widgetGateway.sendTypingIndicator(
              organizationId,
              customer.externalId,
              false,
            );
          }
        }
        return;
      }

      if (response.action === 'IGNORE') {
        // Stop typing
        if (
          channel?.toLowerCase() === 'widget' ||
          channel?.toLowerCase() === 'chat'
        ) {
          const customer = await this.customersService.findOne(
            customerId,
            organizationId,
          );
          if (customer?.externalId) {
            this.widgetGateway.sendTypingIndicator(
              organizationId,
              customer.externalId,
              false,
            );
          }
        }
        return;
      }

      if (response.action === 'ESCALATE' || confidence < threshold) {
        const reason =
          response.escalationReason ||
          (confidence < threshold
            ? `Confidence ${confidence}% below threshold ${threshold}%`
            : 'AI decided to escalate');

        await this.ticketsService.escalateTicketWithAI(
          ticketId,
          organizationId,
          customerId,
          reason,
          response.escalationSummary,
          confidence,
          channel,
        );
      } else if (response.action === 'REPLY' && response.content) {
        const thread = await this.threadsService.getOrCreateThread(
          ticketId,
          customerId,
          organizationId,
        );

        let finalContent = response.content;
        if (org.aiEmailSignature && channel?.toLowerCase() === 'email') {
          finalContent += `\n\n${org.aiEmailSignature}`;
        }

        await this.threadsService.createMessage(
          thread._id.toString(),
          {
            content: finalContent,
            messageType: MessageType.EXTERNAL,
            channel: this.ticketsService.mapChannelToMessageChannel(channel),
          },
          organizationId,
          organizationId,
          UserRole.ADMIN,
          MessageAuthorType.AI,
        );

        await this.ticketsService.update(
          ticketId,
          {
            aiConfidenceScore: confidence,
            isAiEscalated: false,
          } as any,
          organizationId,
          UserRole.ADMIN,
          organizationId,
        );

        // Stop typing immediately after reply (though new message usually clears it implicitly in UI)
        if (
          channel?.toLowerCase() === 'widget' ||
          channel?.toLowerCase() === 'chat'
        ) {
          const customer = await this.customersService.findOne(
            customerId,
            organizationId,
          );
          if (customer?.externalId) {
            this.widgetGateway.sendTypingIndicator(
              organizationId,
              customer.externalId,
              false,
            );
          }
        }
      }
    } finally {
      await this.ticketsService.update(
        ticketId,
        { isAiProcessing: false, isWaitingForNewTopicCheck: false } as any,
        organizationId,
        UserRole.ADMIN,
        organizationId,
      );
    }
  }

  private async handleSendIntervention(data: any): Promise<void> {
    const { ticketId, customerId, organizationId, channel } = data;
    const thread = await this.threadsService.getOrCreateThread(
      ticketId,
      customerId,
      organizationId,
    );

    const interventionMessage =
      "I notice you've been waiting for a while. I want to make sure your time is used effectively—is there anything else I can help you with or any other query I can answer while the agent gets to your previous request?";

    await this.threadsService.createMessage(
      thread._id.toString(),
      {
        content: interventionMessage,
        messageType: MessageType.EXTERNAL,
        channel: this.ticketsService.mapChannelToMessageChannel(channel),
      },
      organizationId,
      organizationId,
      UserRole.ADMIN,
      MessageAuthorType.AI,
    );

    await this.ticketsService.update(
      ticketId,
      { isWaitingForNewTopicCheck: true } as any,
      organizationId,
      UserRole.ADMIN,
      organizationId,
    );
  }

  private async handleSendEscalationNotice(data: any): Promise<void> {
    const { ticketId, customerId, organizationId, channel } = data;
    await this.ticketsService.escalateTicketWithAI(
      ticketId,
      organizationId,
      customerId,
      'Automated Escalation Notice',
      undefined,
      100,
      channel,
    );
  }
}
