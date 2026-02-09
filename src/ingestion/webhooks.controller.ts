import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { IngestionService } from './ingestion.service';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { GetWidgetHistoryDto } from './dto/get-widget-history.dto';
import {
  MessageChannel,
  MessageType,
} from '../threads/entities/message.entity';
import { convert } from 'html-to-text';

import { OrganizationsService } from '../organizations/organizations.service';
import { CustomersService } from '../customers/customers.service';
import { KnowledgeBaseService } from '../ai/knowledge-base.service';
import { playgroundChat } from '../ai/agents/playground';
import { AttachmentsService } from '../attachments/attachments.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  MessageQueueService,
  QueuedMessage,
} from './services/message-queue.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController implements OnModuleInit {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private ingestionService: IngestionService,
    private configService: ConfigService,
    private organizationsService: OrganizationsService,
    private customersService: CustomersService,
    private knowledgeBaseService: KnowledgeBaseService,
    private attachmentsService: AttachmentsService,
    private messageQueueService: MessageQueueService,
  ) {}

  /**
   * Register the message processor when the module initializes
   */
  onModuleInit() {
    this.messageQueueService.registerProcessor(async (job: QueuedMessage) => {
      this.logger.debug(`[Queue Processor] Processing job ${job.id}`);

      if (job.organizationId) {
        // Use ingestWithOrganization for jobs that have org context
        const result = await this.ingestionService.ingestWithOrganization(
          job.payload,
          job.provider,
          job.channel,
          job.organizationId,
        );

        if (!result.success) {
          this.logger.warn(
            `[Queue Processor] Job ${job.id} ingestion failed: ${result.error}`,
          );
          throw new Error(result.error); // Will trigger retry
        }

        this.logger.log(
          `[Queue Processor] Job ${job.id} completed: ticketId=${result.ticketId}`,
        );
      } else {
        // Use standard ingest for jobs without org context
        const result = await this.ingestionService.ingest(
          job.payload,
          job.provider,
          job.channel,
        );

        if (!result.success) {
          this.logger.warn(
            `[Queue Processor] Job ${job.id} ingestion failed: ${result.error}`,
          );
          throw new Error(result.error); // Will trigger retry
        }

        this.logger.log(
          `[Queue Processor] Job ${job.id} completed: ticketId=${result.ticketId}`,
        );
      }
    });

    this.logger.log('Message queue processor initialized');
  }

  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email webhook endpoint',
    description:
      'Receives webhooks from email providers (SendGrid, Mailgun, etc.)',
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: 'Message processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async handleEmail(
    @Body() payload: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.debug('Received email webhook');

    // Extract provider from headers or payload
    const provider = this.extractProvider(headers, payload, 'email');

    // Verify webhook (signature/ID validation would go here)
    // For now, we'll skip verification but log it
    const signature = headers['x-signature'] || headers['x-webhook-signature'];
    const webhookId = headers['x-webhook-id'] || headers['webhook-id'];

    if (signature || webhookId) {
      this.logger.debug(
        `Webhook verification: signature=${!!signature}, id=${!!webhookId}`,
      );
      // TODO: Implement signature verification
    }

    const result = await this.ingestionService.ingest(
      payload,
      provider,
      MessageChannel.EMAIL,
    );

    if (!result.success) {
      this.logger.warn(`Email ingestion failed: ${result.error}`);
      // Still return 200 to prevent webhook retries for processing errors
      // The message is queued for manual review
    }

    return {
      success: result.success,
      ticketId: result.ticketId,
      messageId: result.messageId,
    };
  }

  @Post('sms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SMS webhook endpoint',
    description: 'Receives webhooks from SMS providers (Twilio, etc.)',
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: 'Message processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async handleSms(
    @Body() payload: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.debug('Received SMS webhook');

    const provider = this.extractProvider(headers, payload, 'sms');

    // Verify webhook
    const signature = headers['x-signature'] || headers['x-twilio-signature'];
    const webhookId = headers['x-webhook-id'] || headers['webhook-id'];

    if (signature || webhookId) {
      this.logger.debug(
        `Webhook verification: signature=${!!signature}, id=${!!webhookId}`,
      );
      // TODO: Implement signature verification
    }

    const result = await this.ingestionService.ingest(
      payload,
      provider,
      MessageChannel.SMS,
    );

    if (!result.success) {
      this.logger.warn(`SMS ingestion failed: ${result.error}`);
    }

    return {
      success: result.success,
      ticketId: result.ticketId,
      messageId: result.messageId,
    };
  }

  // ============================================
  // WhatsApp Webhook Endpoints
  // ============================================

  @Get('whatsapp')
  @ApiOperation({
    summary: 'WhatsApp webhook verification',
    description: 'Handles verification requests from Meta for webhook setup',
  })
  @ApiQuery({ name: 'hub.mode', required: false })
  @ApiQuery({ name: 'hub.verify_token', required: false })
  @ApiQuery({ name: 'hub.challenge', required: false })
  @ApiResponse({ status: 200, description: 'Verification successful' })
  @ApiResponse({ status: 403, description: 'Verification failed' })
  handleWhatsAppVerification(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    this.logger.log('WhatsApp webhook verification request received');

    const verifyToken = this.configService.get<string>(
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    );

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified successfully');
      return challenge;
    }

    this.logger.warn('WhatsApp webhook verification failed - token mismatch');
    throw new BadRequestException('Verification failed');
  }

  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'WhatsApp webhook endpoint',
    description: 'Receives webhooks from WhatsApp Cloud API (Meta)',
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: 'Message processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async handleWhatsApp(
    @Body() payload: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.debug(
      'Received WhatsApp webhook:',
      JSON.stringify(payload, null, 2),
    );

    // Meta sends webhooks in a specific format with entry[] array
    if (!payload.entry || !Array.isArray(payload.entry)) {
      this.logger.debug('Not a message webhook, possibly a status update');
      return { success: true, message: 'Acknowledged' };
    }

    const enqueuedJobs: string[] = [];

    // Process each entry (usually just one)
    for (const entry of payload.entry) {
      const changes = entry.changes || [];

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value?.messages || [];
        const contacts = value?.contacts || [];
        const metadata = value?.metadata;

        // Process each message
        for (const message of messages) {
          const contact = contacts.find((c: any) => c.wa_id === message.from);

          // Transform to a normalized format for ingestion
          const normalizedPayload = {
            id: message.id,
            from: message.from,
            fromName: contact?.profile?.name || message.from,
            to: metadata?.display_phone_number,
            phoneNumberId: metadata?.phone_number_id,
            timestamp: message.timestamp,
            type: message.type,
            text: message.text?.body || message.caption || '',
            mediaUrl:
              message.image?.url ||
              message.video?.url ||
              message.audio?.url ||
              message.document?.url,
            mediaType: message.type !== 'text' ? message.type : undefined,
            originalPayload: message,
          };

          this.logger.log(
            `Processing WhatsApp message from ${normalizedPayload.from}: ${normalizedPayload.text?.substring(0, 50)}...`,
          );

          // Enqueue message for async processing instead of blocking
          const jobId = this.messageQueueService.enqueue(
            normalizedPayload,
            'meta',
            MessageChannel.WHATSAPP,
          );

          enqueuedJobs.push(jobId);
          this.logger.log(`WhatsApp message enqueued: jobId=${jobId}`);
        }
      }
    }

    // Return immediately - Meta requires fast responses
    // Processing happens in the background via the queue
    return {
      success: true,
      queued: enqueuedJobs.length,
      jobIds: enqueuedJobs,
    };
  }

  @Post('widget')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Widget webhook endpoint',
    description:
      'Receives messages from the web widget. AI responses are handled by auto-reply logic.',
  })
  @ApiResponse({ status: 200, description: 'Message processed successfully' })
  async handleWidget(
    @Body() payload: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.debug('Received Widget message');

    const channelId = payload.channelId || headers['x-channel-id'];
    if (!channelId) {
      throw new BadRequestException('Channel ID is required');
    }

    // Use ingestWithOrganization since we know the org ID (channelId)
    const result = await this.ingestionService.ingestWithOrganization(
      payload,
      'widget',
      MessageChannel.WIDGET,
      channelId,
    );

    if (!result.success) {
      this.logger.warn(`Widget ingestion failed: ${result.error}`);
      if (result.error && result.error.includes('not found')) {
        throw new BadRequestException(result.error);
      }
      return result;
    }

    // AI response is handled by auto-reply logic in threads service
    return result;
  }

  @Post('widget/upload')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload a file from widget',
    description: 'Uploads a file and returns the attachment details.',
  })
  async handleWidgetUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body('channelId') channelId: string,
    @Headers('x-channel-id') headerChannelId: string,
  ) {
    const orgId = channelId || headerChannelId;

    if (!orgId) {
      throw new BadRequestException('Channel ID is required');
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }

    this.logger.debug(`Received Widget file upload for org ${orgId}`);

    try {
      const attachment = await this.attachmentsService.uploadFile(file, orgId);
      return {
        success: true,
        attachment: {
          id: (attachment as any)._id,
          filename: attachment.filename,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          path: attachment.path,
          url: attachment.path?.startsWith('http')
            ? attachment.path
            : `http://localhost:3005${attachment.path?.startsWith('/') ? '' : '/'}${attachment.path}`,
        },
      };
    } catch (error) {
      this.logger.error(`Widget file upload failed: ${error.message}`);
      throw new BadRequestException(`Upload failed: ${error.message}`);
    }
  }

  @Get('widget/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get widget chat history',
    description: 'Retrieves chat history for a widget session',
  })
  @ApiQuery({
    name: 'channelId',
    required: true,
    description: 'Organization ID',
  })
  @ApiQuery({
    name: 'sessionId',
    required: true,
    description: 'Widget session ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Chat history retrieved successfully',
  })
  async getWidgetHistory(@Query() query: GetWidgetHistoryDto) {
    const { channelId, sessionId } = query;

    this.logger.debug(
      `Fetching widget history for session ${sessionId} in org ${channelId}`,
    );

    // Find the thread by sessionId in metadata
    const thread = await this.ingestionService.findThreadBySessionId(
      sessionId,
      channelId,
    );

    if (!thread) {
      // No conversation yet - return empty
      return { messages: [] };
    }

    // Get external messages only for this thread
    const messages = await this.ingestionService.getThreadMessages(
      thread._id.toString(),
      channelId,
      MessageType.EXTERNAL,
      sessionId,
    );

    return {
      messages: messages.map((msg) => {
        // Extract author name if populated
        let authorName: string | undefined;
        if (msg.authorType === 'user' && msg.authorId) {
          // authorId is populated with User document
          const author = msg.authorId as any;

          // Log to debug
          this.logger.debug(
            `Message ${msg._id}: authorType=${msg.authorType}, authorId type=${typeof author}, has firstName=${!!author.firstName}`,
          );

          // Check if it's a populated object (has firstName/lastName) or just an ObjectId
          if (author.firstName || author.lastName) {
            authorName =
              `${author.firstName || ''} ${author.lastName || ''}`.trim();
            this.logger.debug(`Extracted author name: ${authorName}`);
          } else if (author._id) {
            // It's populated but might not have name fields
            this.logger.debug(
              `Author is populated but missing name fields: ${JSON.stringify(author)}`,
            );
          } else {
            // It's just an ObjectId, not populated
            this.logger.debug(
              `Author is not populated, it's an ObjectId: ${author}`,
            );
          }
        }

        return {
          id: msg._id.toString(),
          text: convert(msg.content, { wordwrap: false }),
          sender: msg.authorType === 'customer' ? 'user' : 'agent',
          authorType: msg.authorType, // Include authorType to differentiate AI vs human agents
          authorName, // Include author name for human agents
          timestamp: msg.createdAt?.getTime() || Date.now(),
          attachments: (msg.attachments || []).map((att: any) => ({
            ...att,
            url: att.path?.startsWith('http')
              ? att.path
              : `http://localhost:3005${att.path?.startsWith('/') ? '' : '/'}${att.path}`,
          })),
        };
      }),
    };
  }

  @Get('widget/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get widget configuration',
    description: 'Retrieves widget appearance and behavior settings',
  })
  @ApiQuery({
    name: 'channelId',
    required: true,
    description: 'Organization ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Widget configuration retrieved successfully',
  })
  async getWidgetConfig(@Query('channelId') channelId: string) {
    if (!channelId) {
      throw new BadRequestException('Channel ID is required');
    }

    this.logger.debug(`Fetching widget config for org ${channelId}`);

    try {
      // Use OrganizationsService to find the org
      const organization = await this.organizationsService.findOne(channelId);

      // Log what we found in DB
      this.logger.log(
        `[WebhooksController] Found org ${(organization as any)._id}, widgetConfig: ${JSON.stringify(organization.widgetConfig)}`,
      );

      // Return defaults if no config exists, or merge defaults with stored config
      const defaultConfig = {
        primaryColor: '#06B6D4',
        secondaryColor: '#0F2035',
        position: 'bottom-right',
        size: 'medium',
        borderRadius: 'rounded',
        logoUrl: '',
        customCSS: '',
        welcomeMessage: 'Hello! How can I help you today?',
        headerText: 'Chat with us',
      };

      // Convert to plain object to avoid Mongoose internal properties
      const storedConfig =
        organization.widgetConfig && (organization.widgetConfig as any).toObject
          ? (organization.widgetConfig as any).toObject()
          : organization.widgetConfig || {};

      this.logger.log(
        `[WebhooksController] Stored config plain object: ${JSON.stringify(storedConfig)}`,
      );

      const config = {
        ...defaultConfig,
        ...storedConfig,
      };

      return config;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch widget config for ${channelId}: ${error.message}`,
      );
      // Fallback to defaults rather than erroring out, so widget still loads
      return {
        primaryColor: '#06B6D4',
        secondaryColor: '#0F2035',
        position: 'bottom-right',
        size: 'medium',
        borderRadius: 'rounded',
        logoUrl: '',
        customCSS: '',
        welcomeMessage: 'Hello! How can I help you today?',
        headerText: 'Chat with us',
      };
    }
  }

  /**
   * Extract provider name from headers or payload
   */
  private extractProvider(
    headers: Record<string, string>,
    payload: Record<string, any>,
    defaultProvider: string,
  ): string {
    // Try to detect provider from headers
    if (headers['user-agent']) {
      const ua = headers['user-agent'].toLowerCase();
      if (ua.includes('sendgrid')) return 'sendgrid';
      if (ua.includes('mailgun')) return 'mailgun';
      if (ua.includes('twilio')) return 'twilio';
      if (ua.includes('meta') || ua.includes('whatsapp')) return 'meta';
    }

    // Try to detect from payload structure
    if (payload.provider) {
      return payload.provider;
    }

    // Check for provider-specific fields
    if (payload['MessageSid'] || payload['SmsSid']) return 'twilio';
    if (payload['entry'] && payload['entry'][0]?.changes) return 'meta';
    if (payload['signature'] && payload['timestamp']) return 'mailgun';
    if (payload['email'] && payload['event']) return 'sendgrid';

    return defaultProvider;
  }
}
