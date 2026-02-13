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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: User.name, schema: UserSchema },
      { name: OrgAnalytics.name, schema: OrgAnalyticsSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCronService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
