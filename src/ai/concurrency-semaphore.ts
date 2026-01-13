import { Logger } from '@nestjs/common';

/**
 * A simple semaphore to limit concurrent execution of tasks.
 */
export class ConcurrencySemaphore {
  private activeCount = 0;
  private readonly queue: (() => void)[] = [];
  private readonly logger = new Logger('ConcurrencySemaphore');

  constructor(private readonly maxConcurrency: number = 1) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }
}

// Global instance for Gemini API to stay within Free Tier limits
export const geminiSemaphore = new ConcurrencySemaphore(1);
