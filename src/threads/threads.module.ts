import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { Thread, ThreadSchema } from './entities/thread.entity';
import { Message, MessageSchema } from './entities/message.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { CustomersModule } from '../customers/customers.module';
import { GroupsModule } from '../groups/groups.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thread.name, schema: ThreadSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    forwardRef(() => TicketsModule),
    CustomersModule,
    GroupsModule,
    DispatcherModule,
  ],
  controllers: [ThreadsController],
  providers: [ThreadsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}

