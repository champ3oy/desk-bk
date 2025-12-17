import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { Ticket, TicketSchema } from './entities/ticket.entity';
import { Tag, TagSchema } from '../tags/entities/tag.entity';
import { CustomersModule } from '../customers/customers.module';
import { GroupsModule } from '../groups/groups.module';
import { ThreadsModule } from '../threads/threads.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Tag.name, schema: TagSchema },
    ]),
    CustomersModule,
    GroupsModule,
    OrganizationsModule,
    ConfigModule,
    forwardRef(() => ThreadsModule),
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
