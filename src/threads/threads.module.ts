import { Module, forwardRef } from '@nestjs/common';
import { WidgetGateway } from '../gateways/widget.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { Thread, ThreadSchema } from './entities/thread.entity';
import { Message, MessageSchema } from './entities/message.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import {
  Customer,
  CustomerSchema,
} from '../customers/entities/customer.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { CustomersModule } from '../customers/customers.module';
import { GroupsModule } from '../groups/groups.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thread.name, schema: ThreadSchema },
      { name: Message.name, schema: MessageSchema },
      { name: User.name, schema: UserSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    forwardRef(() => TicketsModule),
    forwardRef(() => CustomersModule),
    GroupsModule,
    DispatcherModule,

    NotificationsModule,
    UsersModule,
    forwardRef(() => IngestionModule),
  ],
  controllers: [ThreadsController],
  providers: [ThreadsService, WidgetGateway],
  exports: [ThreadsService, WidgetGateway],
})
export class ThreadsModule {}
