import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ThreadsModule } from '../threads/threads.module';
import { CommentsModule } from '../comments/comments.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TrainingModule } from '../training/training.module';
import { KnowledgeBaseService } from './knowledge-base.service';

@Module({
  imports: [
    TicketsModule,
    ThreadsModule,
    CommentsModule,
    OrganizationsModule,
    TrainingModule,
  ],
  controllers: [AiController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class AiModule {}
