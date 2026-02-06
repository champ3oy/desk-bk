import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { CustomerTicketsController } from '../api/mobile/customer-tickets.controller';
import { Ticket, TicketSchema } from './entities/ticket.entity';
import { Counter, CounterSchema } from './entities/counter.entity';
import { AiModule } from '../ai/ai.module'; // Import AiModule for forwardRef check
import { Tag, TagSchema } from '../tags/entities/tag.entity';
import { CustomersModule } from '../customers/customers.module';
import { GroupsModule } from '../groups/groups.module';
import { ThreadsModule } from '../threads/threads.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Tag.name, schema: TagSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    forwardRef(() => CustomersModule),
    GroupsModule,
    OrganizationsModule,
    forwardRef(() => ThreadsModule),
    NotificationsModule,
    UsersModule,
    forwardRef(() => AiModule), // Add AiModule for KnowledgeBaseService
  ],
  controllers: [TicketsController, CustomerTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
