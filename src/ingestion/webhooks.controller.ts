import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { MessageChannel } from '../threads/entities/message.entity';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private ingestionService: IngestionService) {}

  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email webhook endpoint',
    description: 'Receives webhooks from email providers (SendGrid, Mailgun, etc.)',
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
      this.logger.debug(`Webhook verification: signature=${!!signature}, id=${!!webhookId}`);
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
      this.logger.debug(`Webhook verification: signature=${!!signature}, id=${!!webhookId}`);
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

  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'WhatsApp webhook endpoint',
    description: 'Receives webhooks from WhatsApp providers (Meta, etc.)',
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: 'Message processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async handleWhatsApp(
    @Body() payload: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.debug('Received WhatsApp webhook');
    
    const provider = this.extractProvider(headers, payload, 'whatsapp');
    
    // Verify webhook
    const signature = headers['x-signature'] || headers['x-hub-signature-256'];
    const webhookId = headers['x-webhook-id'] || headers['webhook-id'];
    
    if (signature || webhookId) {
      this.logger.debug(`Webhook verification: signature=${!!signature}, id=${!!webhookId}`);
      // TODO: Implement signature verification
    }

    const result = await this.ingestionService.ingest(
      payload,
      provider,
      MessageChannel.WHATSAPP,
    );

    if (!result.success) {
      this.logger.warn(`WhatsApp ingestion failed: ${result.error}`);
    }

    return {
      success: result.success,
      ticketId: result.ticketId,
      messageId: result.messageId,
    };
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

