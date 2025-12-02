import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ThreadsModule } from '../threads/threads.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [TicketsModule, ThreadsModule, CommentsModule],
  controllers: [AiController],
})
export class AiModule {}

