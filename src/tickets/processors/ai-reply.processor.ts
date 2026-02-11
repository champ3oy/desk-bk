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

import { draftResponse } from '../../ai/agents/response';
import { TicketStatus } from '../entities/ticket.entity';
import { UserRole } from '../../users/entities/user.entity';
import { AIModelFactory } from '../../ai/ai-model.factory';
import {
  MessageType,
  MessageChannel,
  MessageAuthorType,
} from '../../threads/entities/message.entity';

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
          console.log(
            `[AiReplyProcessor] Sending typing indicator to ${customer.phone}`,
          );
          this.socialIntegrationService
            .sendWhatsAppTypingStatus(
              organizationId,
              customer.phone,
              'typing_on',
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
        UserRole.CUSTOMER,
        organizationId,
        undefined,
        channel,
        ticket.isWaitingForNewTopicCheck,
      );

      const confidence = response.confidence || 0;
      const threshold = org.aiConfidenceThreshold || 85;

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

        await this.ticketsService.update(
          ticketId,
          {
            isAiEscalated: true,
            aiEscalationReason: response.escalationSummary
              ? `${reason}\n\nSummary: ${response.escalationSummary}`
              : reason,
            aiConfidenceScore: confidence,
            aiAutoReplyDisabled: true,
            status: TicketStatus.ESCALATED,
          } as any,
          organizationId,
          UserRole.ADMIN,
          organizationId,
        );

        this.ticketsService
          .notifyAgentsOfEscalation(ticket, reason, organizationId)
          .catch((err) => console.error(err));

        // Generate AI escalation message
        let escalationMessage = '';
        try {
          const thread = await this.threadsService.getOrCreateThread(
            ticketId,
            customerId,
            organizationId,
          );
          const messages = await this.threadsService.getMessages(
            thread._id.toString(),
            organizationId,
            organizationId,
            UserRole.ADMIN,
          );

          const contextMessages = messages
            .slice(-5)
            .map((m) => `${m.authorType}: ${m.content}`)
            .join('\n');

          const businessStatus =
            this.organizationsService.isWithinBusinessHours(org);
          let businessHoursPromptExtra = '';
          if (!businessStatus.isWithin) {
            const nextOpening = businessStatus.nextOpeningTime
              ? businessStatus.nextOpeningTime.toFormat('DDDD @ t (ZZZZ)')
              : 'our next business day';
            businessHoursPromptExtra = `\n\nCRITICAL: We are currently OUTSIDE of business hours. 
You MUST inform the customer that while you are escalating to a human, they are currently away and will respond on ${nextOpening}. 
Make sure this is very clear so they don't expect an immediate reply.`;
          }

          const prompt = `You are a helpful customer support AI.
The current conversation needs to be escalated to a human agent.
Reason: ${reason}

Context:
Ticket Subject: ${ticket.subject}
Recent Messages:
${contextMessages}${businessHoursPromptExtra}

Task: Write a polite, concise message to the customer explaining that you are passing the conversation to a human agent.
Do not apologize unless necessary. Be professional and reassuring.
Return ONLY the message text. Do NOT use JSON format. Do NOT include quotes at the start or end.`;

          const model = AIModelFactory.create(this.configService, {
            model: 'gemini-3-pro-preview',
          });
          const aiResult = await Promise.race([
            model.invoke(prompt),
            new Promise<any>((_, reject) =>
              setTimeout(
                () =>
                  reject(new Error('Escalation message generation timed out')),
                45000,
              ),
            ),
          ]);

          const generatedText =
            typeof aiResult.content === 'string' ? aiResult.content : '';
          if (generatedText && generatedText.length > 5) {
            escalationMessage = generatedText.trim().replace(/^"|"$/g, '');
          }
        } catch (e) {
          console.error('Failed to generate AI escalation message', e);
        }

        if (!escalationMessage) {
          escalationMessage =
            "I'll connect you with a human agent to assist you further.";
        }

        const thread = await this.threadsService.getOrCreateThread(
          ticketId,
          customerId,
          organizationId,
        );

        await this.threadsService.createMessage(
          thread._id.toString(),
          {
            content: escalationMessage,
            messageType: MessageType.EXTERNAL,
            channel: this.mapChannel(channel),
          },
          organizationId,
          organizationId,
          UserRole.ADMIN,
          MessageAuthorType.AI,
        );

        await this.ticketsService.update(
          ticketId,
          { escalationNoticeSent: true } as any,
          organizationId,
          UserRole.ADMIN,
          organizationId,
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
            channel: this.mapChannel(channel),
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
        channel: this.mapChannel(channel),
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
    const thread = await this.threadsService.getOrCreateThread(
      ticketId,
      customerId,
      organizationId,
    );

    const org = await this.organizationsService.findOne(organizationId);
    const businessStatus = org
      ? this.organizationsService.isWithinBusinessHours(org)
      : { isWithin: true };

    let escalationNotice =
      'Your conversation has been escalated to a human agent. They will respond to you as soon as possible. Thank you for your patience!';

    if (!businessStatus.isWithin) {
      const nextOpening = businessStatus.nextOpeningTime
        ? businessStatus.nextOpeningTime.toFormat('DDDD @ t (ZZZZ)')
        : 'our next business day';
      escalationNotice = `Your conversation has been escalated to a human agent. Please note that we are currently outside of business hours, so an agent will get back to you on ${nextOpening}. Thank you for your patience!`;
    }

    await this.threadsService.createMessage(
      thread._id.toString(),
      {
        content: escalationNotice,
        messageType: MessageType.EXTERNAL,
        channel: this.mapChannel(channel),
      },
      organizationId,
      customerId,
      UserRole.CUSTOMER,
      MessageAuthorType.AI,
    );

    await this.ticketsService.update(
      ticketId,
      { escalationNoticeSent: true } as any,
      organizationId,
      UserRole.ADMIN,
      organizationId,
    );
  }

  private mapChannel(channel?: string): MessageChannel {
    if (!channel) return MessageChannel.EMAIL;
    const c = channel.toLowerCase();
    if (c === 'chat' || c === 'widget') return MessageChannel.WIDGET;
    if (c === 'whatsapp') return MessageChannel.WHATSAPP;
    if (c === 'email') return MessageChannel.EMAIL;
    return channel as any;
  }
}
