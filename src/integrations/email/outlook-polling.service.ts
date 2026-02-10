import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { convert } from 'html-to-text';
import { EmailIntegrationService } from './email-integration.service';
import { IngestionService } from '../../ingestion/ingestion.service';
import {
  EmailIntegrationStatus,
  EmailProvider,
} from './entities/email-integration.entity';
import { MessageChannel } from '../../threads/entities/message.entity';
import { IncomingMessageDto } from '../../ingestion/dto/incoming-message.dto';
import { StorageService } from '../../storage/storage.service';

import { ConfigService } from '@nestjs/config';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutlookPollingService {
  private readonly logger = new Logger(OutlookPollingService.name);
  private isPolling = false;

  constructor(
    private emailIntegrationService: EmailIntegrationService,
    @Inject(forwardRef(() => IngestionService))
    private ingestionService: IngestionService,
    private storageService: StorageService,
    private configService: ConfigService,
    @InjectQueue('email-ingestion') private emailQueue: Queue,
  ) {}

  /**
   * Poll for new emails every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollEmails() {
    if (this.configService.get<boolean>('ai.disablePolling')) {
      return;
    }

    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      // Get all active integrations
      const integrations =
        await this.emailIntegrationService.findAllActiveSystem();

      const outlookIntegrations = integrations.filter(
        (i) => i.provider === EmailProvider.OUTLOOK,
      );

      for (const integration of outlookIntegrations) {
        try {
          await this.pollIntegration(integration);
        } catch (error) {
          this.logger.error(
            `Error polling Outlook for ${integration.email}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error in Outlook pollEmails loop: ${error.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  async syncMessagesManually(integration: any, days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const queryDate = date.toISOString();
    await this.fetchMessagesAndQueue(integration, queryDate);
  }

  private async pollIntegration(integration: any) {
    let queryDate: string;

    if (integration.lastSyncedAt) {
      queryDate = integration.lastSyncedAt.toISOString();
    } else {
      // First sync: start from when the integration was added/created
      // This prevents ingesting old emails prior to connection
      const date = integration['createdAt']
        ? new Date(integration['createdAt'])
        : new Date();
      queryDate = date.toISOString();
    }

    // Capture the time BEFORE functionality to update lastSyncedAt safely
    const newSyncTime = new Date();

    await this.fetchMessagesAndQueue(integration, queryDate);

    // Update lastSyncedAt
    integration.lastSyncedAt = newSyncTime;
    await integration.save();
  }

  private async fetchMessagesAndQueue(integration: any, dateIsoString: string) {
    const { client } = await this.emailIntegrationService.getOutlookClient(
      integration.email,
    );

    // Fetch messages received AFTER the date
    // Graph API: receivedDateTime ge 2023...
    // Also order by receivedDateTime desc

    let url = `/me/messages?$filter=receivedDateTime ge ${dateIsoString} and from/emailAddress/address ne '${integration.email}'&$orderby=receivedDateTime desc&$top=50&$select=id,receivedDateTime,from,toRecipients,subject,body,internetMessageHeaders,conversationId,isRead`;

    let hasNext = true;
    let pageCount = 0;
    const maxPages = 5; // Safety limit

    while (hasNext && pageCount < maxPages) {
      const response = await client.api(url).get();
      const messages = response.value;

      if (!messages || messages.length === 0) {
        break;
      }

      // Process oldest to newest for consistent threading if we were strictly chronological,
      // but we fetched DESC. So we process in reverse of the list (which is Newest->Oldest).
      // So reversing checks out.
      const messagesToProcess = [...messages].reverse();

      for (const msg of messagesToProcess) {
        await this.emailQueue.add('outlook-job', {
          integrationId: integration._id,
          messageId: msg.id,
          provider: 'outlook',
        });
      }

      if (response['@odata.nextLink']) {
        url = response['@odata.nextLink'];
        pageCount++;
      } else {
        hasNext = false;
      }
    }
  }

  /**
   * Public method called by worker to process a single message
   */
  async processSingleMessage(integrationId: string, messageId: string) {
    try {
      const integration =
        await this.emailIntegrationService.findById(integrationId);
      if (!integration) {
        this.logger.error(
          `Integration ${integrationId} not found during processing`,
        );
        return;
      }

      const { client } = await this.emailIntegrationService.getOutlookClient(
        integration.email,
      );

      // Fetch full message details
      // We need same fields as listing or just all relevant ones
      // $select is good practice to avoid over-fetching
      const msg = await client
        .api(`/me/messages/${messageId}`)
        .select(
          'id,receivedDateTime,from,toRecipients,subject,body,internetMessageHeaders,conversationId,isRead,sender',
        )
        .get();

      const mappedMessage = await this.mapOutlookMessageToDto(
        msg,
        integration.email,
        client,
        integration,
      );

      // Ingest with organizationId from the integration
      const result = await this.ingestionService.ingestWithOrganization(
        mappedMessage,
        'outlook-polling',
        MessageChannel.EMAIL,
        integration.organizationId.toString(),
      );

      if (result.success) {
        this.logger.debug(
          `Ingested Outlook message ${mappedMessage.messageId}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error processing Outlook message ${messageId}: ${err.message}`,
      );
      throw err;
    }
  }

  private async mapOutlookMessageToDto(
    msg: any,
    connectedEmail: string,
    client: any,
    integration: any,
  ): Promise<IncomingMessageDto> {
    // Extract sender information with multiple fallbacks
    let fromEmail = '';
    let fromName = '';

    // Try different possible locations for sender info
    if (msg.from?.emailAddress?.address) {
      fromEmail = msg.from.emailAddress.address;
      fromName = msg.from.emailAddress.name || fromEmail;
    } else if (msg.sender?.emailAddress?.address) {
      // Sometimes Outlook uses 'sender' instead of 'from'
      fromEmail = msg.sender.emailAddress.address;
      fromName = msg.sender.emailAddress.name || fromEmail;
    }

    // If still no email, try to extract from headers
    if (!fromEmail && msg.internetMessageHeaders) {
      const findHeader = (name: string) =>
        msg.internetMessageHeaders.find(
          (h: any) => h.name.toLowerCase() === name.toLowerCase(),
        )?.value;
      const fromHeader = findHeader('from');
      if (fromHeader) {
        // Parse "Name <email@domain.com>" format
        const emailMatch =
          fromHeader.match(/<([^>]+)>/) ||
          fromHeader.match(/([^\s<]+@[^\s>]+)/);
        if (emailMatch) {
          fromEmail = emailMatch[1];
          const nameMatch = fromHeader.match(/^([^<]+)</);
          if (nameMatch) {
            fromName = nameMatch[1].trim().replace(/"/g, '');
          }
        }
      }
    }

    // Final fallback
    if (!fromName) fromName = fromEmail;

    // Log if we still don't have an email (this shouldn't happen but helps debugging)
    if (!fromEmail) {
      if (msg.internetMessageHeaders) {
        const findHeader = (name: string) =>
          msg.internetMessageHeaders.find(
            (h: any) => h.name.toLowerCase() === name.toLowerCase(),
          )?.value;
      }
      // Skip this message - we can't process it without a sender
      throw new Error(
        `Cannot process message ${msg.id}: no sender email found`,
      );
    }

    // Get Message ID and References from headers if possible for threading
    let messageId = msg.id; // Graph ID as fallback
    let inReplyTo = undefined;
    let references = undefined;

    if (msg.internetMessageHeaders) {
      const findHeader = (name: string) =>
        msg.internetMessageHeaders.find(
          (h: any) => h.name.toLowerCase() === name.toLowerCase(),
        )?.value;

      const rawMessageId = findHeader('message-id');
      if (rawMessageId) messageId = rawMessageId.replace(/^<|>$/g, '');

      const rawInReplyTo = findHeader('in-reply-to');
      if (rawInReplyTo) inReplyTo = rawInReplyTo.replace(/^<|>$/g, '');

      const rawReferences = findHeader('references');
      if (rawReferences) references = rawReferences;
    }

    // Content
    let content = '';
    let rawBody = '';

    if (msg.body) {
      const rawContent = msg.body.content || '';

      // Check if content is HTML
      if (
        msg.body.contentType === 'html' ||
        rawContent.trim().startsWith('<')
      ) {
        rawBody = rawContent; // Store HTML version
        content = convert(rawContent, {
          wordwrap: false,
          preserveNewlines: true,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } else {
        content = rawContent;
      }
    }

    // Process inline images
    if (rawBody && rawBody.includes('cid:')) {
      try {
        // Fetch attachments for this message
        const attachmentsResponse = await client
          .api(`/me/messages/${msg.id}/attachments`)
          .select('id,contentType,contentBytes,contentId,isInline,name,size')
          .get();

        const attachments = attachmentsResponse.value;

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            // Check if we have contentId and contentBytes and it is marked as inline
            // Note: Some inline images might not be marked isInline=true in Graph API but have contentId
            if (att.contentId && att.contentBytes) {
              const cid = att.contentId;
              const mimeType = att.contentType || 'image/jpeg';

              const buffer = Buffer.from(att.contentBytes, 'base64');

              // Upload to storage to get a public URL (better than Data URI for email clients)
              const savedFile = await this.storageService.saveFile(
                att.name || 'image',
                buffer,
                mimeType,
              );

              const imageUrl = savedFile.path;

              // Replace all occurrences of cid:{contentId}
              // We use a regex for case-insensitive replacement because Outlook CIDs can be messy
              // Escape special characters in cid for regex
              const escapedCid = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(`cid:${escapedCid}`, 'gi');

              rawBody = rawBody.replace(regex, imageUrl);

              // Also handle case where CID might be wrapped in <> in the body but not in the ID, or vice versa
              // If cid is "foo", body might have "cid:<foo>"? Unlikely but possible in some MIME logic.
              // More common: contentId="<foo>", body="cid:foo".
              if (cid.startsWith('<') && cid.endsWith('>')) {
                const unwrapped = cid.slice(1, -1);
                const escapedUnwrapped = unwrapped.replace(
                  /[.*+?^${}()|[\]\\]/g,
                  '\\$&',
                );
                const regexUnwrapped = new RegExp(
                  `cid:${escapedUnwrapped}`,
                  'gi',
                );
                rawBody = rawBody.replace(regexUnwrapped, imageUrl);
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch attachments for Outlook message ${msg.id}: ${error.message}`,
        );
      }
    }

    // Process standard attachments
    const attachments: any[] = [];
    try {
      const attachmentsResponse = await client
        .api(`/me/messages/${msg.id}/attachments`)
        .select('id,contentType,contentBytes,contentId,isInline,name,size')
        .get();

      const fetchedAttachments = attachmentsResponse.value;
      if (fetchedAttachments && fetchedAttachments.length > 0) {
        for (const att of fetchedAttachments) {
          // Inclusive logic: If it has a name and content, it's an attachment.
          // Note: We still process inline images for CID replacement in rawBody,
          // but we also include them here to ensure they're accessible as files.
          if (att.name && att.contentBytes) {
            const buffer = Buffer.from(att.contentBytes, 'base64');
            const savedFile = await this.storageService.saveFile(
              att.name || 'attachment',
              buffer,
              att.contentType || 'application/octet-stream',
            );

            attachments.push({
              filename: savedFile.filename,
              originalName: att.name || 'attachment',
              mimeType: att.contentType || 'application/octet-stream',
              size: savedFile.size,
              path: savedFile.path,
              contentId: att.contentId
                ? att.contentId.replace(/^<|>$/g, '')
                : undefined,
            });
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to process attachments for Outlook message ${msg.id}: ${error.message}`,
      );
    }

    const dto: IncomingMessageDto = {
      channel: MessageChannel.EMAIL,
      senderEmail: fromEmail,
      senderName: fromName,
      recipientEmail: connectedEmail,
      subject: msg.subject || '',
      content,
      rawBody,
      messageId,
      inReplyTo,
      references,
      metadata: {
        outlookId: msg.id,
        conversationId: msg.conversationId,
        receivedDateTime: msg.receivedDateTime,
      },
      attachments: attachments,
      integrationId: integration['_id']
        ? integration['_id'].toString()
        : undefined,
    };
    return dto;
  }
}
