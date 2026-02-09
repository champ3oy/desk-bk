import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { GmailPollingService } from '../integrations/email/gmail-polling.service';
import { OutlookPollingService } from '../integrations/email/outlook-polling.service';

@Processor('email-ingestion', { concurrency: 5 })
export class EmailIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailIngestionProcessor.name);

  constructor(
    @Inject(forwardRef(() => GmailPollingService))
    private gmailPollingService: GmailPollingService,
    @Inject(forwardRef(() => OutlookPollingService))
    private outlookPollingService: OutlookPollingService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { integrationId, messageId, provider } = job.data;
    this.logger.debug(
      `Processing email job: ${job.id} - ${provider} / ${messageId}`,
    );

    try {
      if (provider === 'gmail') {
        await this.gmailPollingService.processSingleMessage(
          integrationId,
          messageId,
        );
      } else if (provider === 'outlook') {
        await this.outlookPollingService.processSingleMessage(
          integrationId,
          messageId,
        );
      } else {
        this.logger.warn(`Unknown provider in job ${job.id}: ${provider}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process email job ${job.id}: ${error.message}`,
        error.stack,
      );
      throw error; // Let BullMQ retry
    }
  }
}
