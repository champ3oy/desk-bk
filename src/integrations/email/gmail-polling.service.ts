import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { convert } from 'html-to-text';
import { EmailIntegrationService } from './email-integration.service';
import { IngestionService } from '../../ingestion/ingestion.service';
import { EmailIntegrationStatus } from './entities/email-integration.entity';
import { MessageChannel } from '../../threads/entities/message.entity';
import { IncomingMessageDto } from '../../ingestion/dto/incoming-message.dto';

@Injectable()
export class GmailPollingService {
  private readonly logger = new Logger(GmailPollingService.name);
  private isPolling = false;

  constructor(
    private emailIntegrationService: EmailIntegrationService,
    @Inject(forwardRef(() => IngestionService))
    private ingestionService: IngestionService,
  ) {}

  /**
   * Poll for new emails every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollEmails() {
    if (this.isPolling) {
      this.logger.debug('Polling already in progress, skipping...');
      return;
    }

    this.isPolling = true;
    try {
      this.logger.log('Starting email polling...');
      // 1. Get all active integrations
      // Note: We need a way to get ALL active integrations across organizations for the system job
      // We'll add a findAllActive method to the service
      const integrations = await this.emailIntegrationService.findAllActiveSystem();
      
      // Filter to only Gmail integrations
      const gmailIntegrations = integrations.filter(i => i.provider === 'gmail');

      this.logger.debug(`Found ${gmailIntegrations.length} active integrations to poll`);

      for (const integration of gmailIntegrations) {
        try {
          this.logger.debug(`Polling integration for email: ${integration.email}`);
          await this.pollIntegration(integration);
        } catch (error) {
          this.logger.error(
            `Error polling for ${integration.email}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error in pollEmails loop: ${error.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchMessages(integration: any, query: string) {
    const { gmail } = await this.emailIntegrationService.getGmailClient(
      integration.email,
    );

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50, // Batch size
    });

    const messages = res.data.messages;

    if (!messages || messages.length === 0) {
      return;
    }

    this.logger.debug(`Found ${messages.length} messages for ${integration.email} with query: ${query}`);

    // Fetch full content for each message
    // Process oldest to newest
    const messagesToProcess = messages.reverse();

    for (const msgStub of messagesToProcess) {
       try {
           const fullMsg = await gmail.users.messages.get({
               userId: 'me',
               id: msgStub.id,
               format: 'full',
           });
           
           const mappedMessage = this.mapGmailMessageToDto(fullMsg.data, integration.email);
           
           this.logger.debug(`Mapped message before ingestion: senderEmail=${mappedMessage.senderEmail}, senderName=${mappedMessage.senderName}`);
           
           // Ingest with organizationId from the integration
           const result = await this.ingestionService.ingestWithOrganization(
               mappedMessage,
               'gmail-polling',
               MessageChannel.EMAIL,
               integration.organizationId.toString()
           );
           
           if (result.success) {
               this.logger.debug(`Ingested message ${mappedMessage.messageId}`);
           } else {
               this.logger.warn(`Failed to ingest message ${mappedMessage.messageId}: ${result.error}`);
           }
           
       } catch (err) {
           this.logger.error(`Error processing message ${msgStub.id}: ${err.message}`);
       }
    }
  }

  async manualSync(integrationId: string, days: number = 7) {
      // Find integration logic should be moved here or passed in. 
      // For now assume we get the integration.
      // But we better get it via ID.
      // Actually service method signature should probably take email or object.
      // Let's rely on finding it by email since frontend sends email? 
      // Actually Controller will pass the object or ID? 
      // Let's make this method accept the integration object to be safe/flexible or look it up.
      // NOTE: We need the integration logic from pollEmails.
  }
  
  async syncMessagesManually(integration: any, days: number) {
      const seconds = days * 24 * 60 * 60;
      const after = Math.floor((Date.now() / 1000) - seconds);
      const query = `after:${after}`;
      this.logger.log(`Starting manual sync for ${integration.email} looking back ${days} days...`);
      await this.fetchMessages(integration, query);
      this.logger.log(`Manual sync completed for ${integration.email}`);
  }

  private async pollIntegration(integration: any) {
    let query = '';
    
    if (integration.lastSyncedAt) {
        // Convert to seconds
        const after = Math.floor(integration.lastSyncedAt.getTime() / 1000);
        query = `after:${after}`;
    } else {
        // First sync: maybe just last 24h
        const yesterday = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
        query = `after:${yesterday}`;
    }

    await this.fetchMessages(integration, query);

    // Update lastSyncedAt
    integration.lastSyncedAt = new Date();
    await integration.save();
  }

  private mapGmailMessageToDto(gmailMsg: any, connectedEmail: string): IncomingMessageDto {
      const headers = gmailMsg.payload.headers;
      
      const getHeader = (name: string) => {
          const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
          return h ? h.value : undefined;
      };

      const subject = getHeader('Subject') || '';
      const from = getHeader('From') || '';
      const to = getHeader('To') || '';
      const messageId = getHeader('Message-ID');
      const inReplyTo = getHeader('In-Reply-To');
      const references = getHeader('References');
      
      // Parse Body
      // Gmail payload is complex (nested multipart).
      let content = '';
      if (gmailMsg.payload.body?.data) {
          content = Buffer.from(gmailMsg.payload.body.data, 'base64').toString('utf-8');
      } else if (gmailMsg.payload.parts) {
          // Find text/plain part first, then HTML as fallback
          const findPart = (parts, mimeType) => {
              for (const part of parts) {
                  if (part.mimeType === mimeType && part.body?.data) {
                      return Buffer.from(part.body.data, 'base64').toString('utf-8');
                  }
                  if (part.parts) {
                      const found = findPart(part.parts, mimeType);
                      if (found) return found;
                  }
              }
              return '';
          };
          
          // Try text/plain first
          content = findPart(gmailMsg.payload.parts, 'text/plain');
          
          // If no text/plain, try HTML and convert to text
          if (!content) {
              const htmlContent = findPart(gmailMsg.payload.parts, 'text/html');
              if (htmlContent) {
                  content = convert(htmlContent, {
                      wordwrap: false,
                      preserveNewlines: true,
                      selectors: [
                          { selector: 'a', options: { ignoreHref: true } },
                          { selector: 'img', format: 'skip' },
                      ],
                  });
              }
          }
      }

      // Parse Sender
      // "Name <email>" or "email"
      // Regex to capture: Name (optional), <Email> (optional), or just Email
      // Case 1: "Example Person <example@test.com>" -> [whole, "Example Person ", "example@test.com", undefined]
      // Case 2: "<example@test.com>" -> [whole, undefined, "example@test.com", undefined]
      // Case 3: "example@test.com" -> [whole, undefined, undefined, "example@test.com"]
      
      const fromMatch = from.match(/^(?:(?:"?([^<]+)"?\s*)?<([^>]+)>|([^<]+))$/);
      let senderName, senderEmail;

      if (fromMatch) {
          senderName = fromMatch[1] ? fromMatch[1].replace(/"/g, '').trim() : undefined;
          senderEmail = (fromMatch[2] || fromMatch[3] || '').trim();
      } else {
        // Fallback simple extract
         const simpleMatch = from.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
         if (simpleMatch) {
             senderEmail = simpleMatch[0];
         }
      }

      this.logger.debug(`Parsed Sender: From="${from}" -> Name="${senderName}", Email="${senderEmail}"`);

      return {
          channel: MessageChannel.EMAIL,
          senderEmail,
          senderName,
          recipientEmail: connectedEmail, // The inbox address
          subject,
          content,
          messageId: messageId ? messageId.replace(/^<|>$/g, '') : undefined,
          inReplyTo: inReplyTo ? inReplyTo.replace(/^<|>$/g, '') : undefined,
          references,
          metadata: {
              gmailId: gmailMsg.id,
              threadId: gmailMsg.threadId,
              labelIds: gmailMsg.labelIds,
          },
          attachments: [], // Attachments handling requires storage integration (S3/GCS) which is pending.
      };
  }
}
