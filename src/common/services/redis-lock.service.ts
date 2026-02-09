import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisLockService implements OnModuleInit {
  private redis: Redis;
  private readonly logger = new Logger(RedisLockService.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    // Check if REDIS_URL is configured
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (redisUrl) {
      this.redis = new Redis(redisUrl);
      this.logger.log('RedisLockService initialized with Redis');

      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error', err);
      });
    } else {
      this.logger.warn(
        'REDIS_URL not configured. RedisLockService will operate in NO-OP mode (unsafe for production concurrency).',
      );
    }
  }

  /**
   * Acquire a lock for a specific resource key.
   * @param key Unique key for the resource
   * @param ttlSeconds Time to live in seconds (default 60s)
   * @returns true if lock acquired, false if already locked
   */
  async acquireLock(key: string, ttlSeconds = 60): Promise<boolean> {
    if (!this.redis) return true; // Fail open if no Redis (unsafe but prevents crash)

    try {
      const result = await this.redis.set(
        `lock:${key}`,
        'locked',
        'EX',
        ttlSeconds,
        'NX', // Only set if not exists
      );
      return result === 'OK';
    } catch (e) {
      this.logger.error(`Failed to acquire lock for ${key}`, e);
      return false; // Fail safe on error
    }
  }

  /**
   * Release a lock.
   */
  async releaseLock(key: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(`lock:${key}`);
    } catch (e) {
      this.logger.error(`Failed to release lock for ${key}`, e);
    }
  }
}
