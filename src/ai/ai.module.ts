import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ThreadsModule } from '../threads/threads.module';
import { CommentsModule } from '../comments/comments.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TrainingModule } from '../training/training.module';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CustomersModule } from '../customers/customers.module';
import { AiVoiceGateway } from '../gateways/ai-voice.gateway';
import { AiTelemetryModule } from './telemetry/ai-telemetry.module';

import { SmartCache, SmartCacheSchema } from './entities/smart-cache.entity';
import { SmartCacheService } from './smart-cache.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SmartCache.name, schema: SmartCacheSchema },
    ]),
    forwardRef(() => TicketsModule),
    ThreadsModule,
    CommentsModule,
    OrganizationsModule,
    TrainingModule,
    ConfigModule,
    forwardRef(() => CustomersModule),
    AiTelemetryModule,
  ],
  controllers: [AiController],
  providers: [KnowledgeBaseService, AiVoiceGateway, SmartCacheService],
  exports: [KnowledgeBaseService, SmartCacheService],
})
export class AiModule {}
