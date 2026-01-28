import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    TicketsModule,
    ThreadsModule,
    CommentsModule,
    OrganizationsModule,
    TrainingModule,
    ConfigModule,
    CustomersModule,
  ],
  controllers: [AiController],
  providers: [KnowledgeBaseService, AiVoiceGateway],
  exports: [KnowledgeBaseService],
})
export class AiModule {}
