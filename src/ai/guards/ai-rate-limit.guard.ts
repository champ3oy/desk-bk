import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class AiRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AiRateLimitGuard.name);
  private redis: Redis | null = null;

  // Rate limits
  private static readonly USER_REQUESTS_PER_MINUTE = 10;
  private static readonly USER_REQUESTS_PER_HOUR = 100;
  private static readonly ORG_REQUESTS_PER_MINUTE = 60;
  private static readonly ORG_REQUESTS_PER_HOUR = 500;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error in rate limiter', err);
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.redis) return true; // Fail open if no Redis

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const organizationId = request.user?.organizationId;

    if (!userId || !organizationId) return true;

    try {
      // Check all limits in parallel
      const [userMinute, userHour, orgMinute, orgHour] = await Promise.all([
        this.checkLimit(
          `ai_rate:user:${userId}:min`,
          AiRateLimitGuard.USER_REQUESTS_PER_MINUTE,
          60,
        ),
        this.checkLimit(
          `ai_rate:user:${userId}:hr`,
          AiRateLimitGuard.USER_REQUESTS_PER_HOUR,
          3600,
        ),
        this.checkLimit(
          `ai_rate:org:${organizationId}:min`,
          AiRateLimitGuard.ORG_REQUESTS_PER_MINUTE,
          60,
        ),
        this.checkLimit(
          `ai_rate:org:${organizationId}:hr`,
          AiRateLimitGuard.ORG_REQUESTS_PER_HOUR,
          3600,
        ),
      ]);

      if (!userMinute) {
        this.logger.warn(
          `User ${userId} exceeded per-minute AI rate limit`,
        );
        throw new HttpException(
          'Too many AI requests. Please wait a moment before trying again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!userHour) {
        this.logger.warn(
          `User ${userId} exceeded hourly AI rate limit`,
        );
        throw new HttpException(
          'Hourly AI request limit reached. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!orgMinute) {
        this.logger.warn(
          `Organization ${organizationId} exceeded per-minute AI rate limit`,
        );
        throw new HttpException(
          'Your organization has exceeded the AI rate limit. Please wait a moment.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!orgHour) {
        this.logger.warn(
          `Organization ${organizationId} exceeded hourly AI rate limit`,
        );
        throw new HttpException(
          'Your organization has reached the hourly AI request limit.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error('Rate limit check failed', e);
      return true; // Fail open on Redis errors
    }
  }

  private async checkLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const current = await this.redis!.incr(key);
    if (current === 1) {
      await this.redis!.expire(key, windowSeconds);
    }
    return current <= maxRequests;
  }
}
