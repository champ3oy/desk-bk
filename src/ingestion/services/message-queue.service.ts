import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MessageChannel } from '../../threads/entities/message.entity';

export interface QueuedMessage {
  id: string;
  payload: Record<string, any>;
  provider: string;
  channel: MessageChannel;
  organizationId?: string; // Optional - for ingestWithOrganization
  addedAt: Date;
  attempts: number;
}

@Injectable()
export class MessageQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageQueueService.name);
  private queue: QueuedMessage[] = [];
  private processing = false;
  private processor: ((job: QueuedMessage) => Promise<void>) | null = null;
  private readonly maxAttempts = 3;
  private readonly concurrency = 3; // Process multiple messages at once to avoid blocking
  private activeJobs = 0;
  private shutdownRequested = false;

  /**
   * Register the processor function that will handle each queued message
   */
  registerProcessor(fn: (job: QueuedMessage) => Promise<void>) {
    this.processor = fn;
    this.logger.log('Message queue processor registered');
  }

  /**
   * Add a message to the queue
   */
  enqueue(
    payload: Record<string, any>,
    provider: string,
    channel: MessageChannel,
    organizationId?: string,
  ): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const job: QueuedMessage = {
      id,
      payload,
      provider,
      channel,
      organizationId,
      addedAt: new Date(),
      attempts: 0,
    };

    this.queue.push(job);
    this.logger.log(
      `[Queue] Message enqueued: ${id} (channel: ${channel}, queue size: ${this.queue.length})`,
    );

    // Start processing if not already running
    this.processQueue();

    return id;
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      activeJobs: this.activeJobs,
    };
  }

  /**
   * Process the queue
   */
  private async processQueue() {
    if (this.processing || this.shutdownRequested) {
      return;
    }

    if (!this.processor) {
      this.logger.warn(
        '[Queue] No processor registered, skipping queue processing',
      );
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && !this.shutdownRequested) {
      // Check concurrency limit
      if (this.activeJobs >= this.concurrency) {
        await this.sleep(100);
        continue;
      }

      const job = this.queue.shift();
      if (!job) continue;

      this.activeJobs++;
      job.attempts++;

      this.logger.debug(
        `[Queue] Processing job ${job.id} (attempt ${job.attempts}/${this.maxAttempts})`,
      );

      try {
        await this.processor(job);
        this.logger.debug(`[Queue] Job ${job.id} completed successfully`);
      } catch (error) {
        this.logger.error(
          `[Queue] Job ${job.id} failed: ${error.message}`,
          error.stack,
        );

        // Retry if attempts remaining
        if (job.attempts < this.maxAttempts) {
          this.logger.log(`[Queue] Re-queuing job ${job.id} for retry`);
          this.queue.push(job); // Add back to end of queue
        } else {
          this.logger.error(
            `[Queue] Job ${job.id} exhausted all ${this.maxAttempts} attempts, discarding`,
          );
        }
      } finally {
        this.activeJobs--;
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown - wait for active jobs to complete
   */
  async onModuleDestroy() {
    this.logger.log(
      '[Queue] Shutdown requested, waiting for active jobs to complete...',
    );
    this.shutdownRequested = true;

    // Wait for active jobs (max 30 seconds)
    const maxWait = 30000;
    const startTime = Date.now();

    while (this.activeJobs > 0 && Date.now() - startTime < maxWait) {
      await this.sleep(100);
    }

    if (this.activeJobs > 0) {
      this.logger.warn(
        `[Queue] Shutdown timeout, ${this.activeJobs} jobs still active`,
      );
    } else {
      this.logger.log('[Queue] All jobs completed, shutdown complete');
    }

    if (this.queue.length > 0) {
      this.logger.warn(
        `[Queue] ${this.queue.length} messages in queue will be lost`,
      );
    }
  }
}
