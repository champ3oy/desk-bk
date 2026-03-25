import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsCronService } from './analytics-cron.service';
import { Ticket, TicketSchema } from '../tickets/entities/ticket.entity';
import {
  Customer,
  CustomerSchema,
} from '../customers/entities/customer.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import {
  OrgAnalytics,
  OrgAnalyticsSchema,
} from './entities/org-analytics.entity';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/entities/organization.entity';
import {
  Category,
  CategorySchema,
} from '../categories/entities/category.entity';
import { Thread, ThreadSchema } from '../threads/entities/thread.entity';
import { Message, MessageSchema } from '../threads/entities/message.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: User.name, schema: UserSchema },
      { name: OrgAnalytics.name, schema: OrgAnalyticsSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Thread.name, schema: ThreadSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCronService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
