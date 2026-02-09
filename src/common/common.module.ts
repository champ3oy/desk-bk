import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisLockService } from './services/redis-lock.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisLockService],
  exports: [RedisLockService],
})
export class CommonModule {}
