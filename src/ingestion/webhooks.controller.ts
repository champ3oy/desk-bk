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
import { MessageChannel } from '../threads/entities/message.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { CustomersService } from '../customers/customers.service';
import { KnowledgeBaseService } from '../ai/knowledge-base.service';
import { playgroundChat } from '../ai/agents/playground';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private ingestionService: IngestionService,
    private configService: ConfigService,
    private organizationsService: OrganizationsService,
    private customersService: CustomersService,
    private knowledgeBaseService: KnowledgeBaseService,
  ) {}

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

          const result = await this.ingestionService.ingest(
            normalizedPayload,
            'meta',
            MessageChannel.WHATSAPP,
          );

          if (!result.success) {
            this.logger.warn(`WhatsApp ingestion failed: ${result.error}`);
          } else {
            this.logger.log(
              `WhatsApp message ingested: ticketId=${result.ticketId}`,
            );
          }
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return { success: true };
  }

  @Post('widget')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Widget webhook endpoint',
    description:
      'Receives messages from the web widget and returns AI response',
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

    // Generate AI response
    let aiResponse: string | null = null;
    try {
      const userMessage = payload.content || '';
      const customerEmail = payload.email;

      // Get chat history for context (last 10 messages)
      const thread = await this.ingestionService.findThreadBySessionId(
        payload.sessionId,
        channelId,
      );

      let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      if (thread) {
        const messages = await this.ingestionService.getThreadMessages(
          thread._id.toString(),
          channelId,
        );
        // Convert to history format, excluding the current message
        history = messages
          .slice(-10) // Last 10 messages
          .filter((m) => m.content && m.content.trim() !== '')
          .map((m) => ({
            role:
              m.authorType === 'customer'
                ? ('user' as const)
                : ('assistant' as const),
            content: m.content,
          }));
      }

      // Call AI to generate response
      const response = await playgroundChat(
        userMessage,
        this.configService,
        this.organizationsService,
        this.knowledgeBaseService,
        this.customersService,
        channelId,
        history.length > 0 ? history : undefined,
        undefined, // Use default provider
        undefined, // Use default model
        customerEmail,
      );

      aiResponse = response.content;
      this.logger.debug(
        `AI response generated for widget: ${aiResponse?.substring(0, 100)}...`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to generate AI response: ${error.message}`,
        error.stack,
      );
      // Don't fail the request, just return without AI response
    }

    return {
      ...result,
      aiResponse,
    };
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
  async getWidgetHistory(
    @Query('channelId') channelId: string,
    @Query('sessionId') sessionId: string,
  ) {
    if (!channelId || !sessionId) {
      throw new BadRequestException('channelId and sessionId are required');
    }

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

    // Get messages for this thread
    const messages = await this.ingestionService.getThreadMessages(
      thread._id.toString(),
      channelId,
    );

    return {
      messages: messages.map((msg) => ({
        id: msg._id.toString(),
        text: msg.content,
        sender: msg.authorType === 'customer' ? 'user' : 'agent',
        timestamp: msg.createdAt?.getTime() || Date.now(),
      })),
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
