import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IngestionService } from './ingestion.service';
import { WebhooksController } from './webhooks.controller';
import { EmailParser } from './parsers/email.parser';
import { SmsParser } from './parsers/sms.parser';
import { WhatsAppParser } from './parsers/whatsapp.parser';
import { OrganizationResolver } from './resolvers/organization.resolver';
import { CustomerResolver } from './resolvers/customer.resolver';
import { TicketResolver } from './resolvers/ticket.resolver';
import { PendingReviewService } from './services/pending-review.service';
import {
  PendingReview,
  PendingReviewSchema,
} from './entities/pending-review.entity';
import { Message, MessageSchema } from '../threads/entities/message.entity';
import { Thread, ThreadSchema } from '../threads/entities/thread.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CustomersModule } from '../customers/customers.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ThreadsModule } from '../threads/threads.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PendingReview.name, schema: PendingReviewSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Thread.name, schema: ThreadSchema },
    ]),
    OrganizationsModule,
    CustomersModule,
    TicketsModule,
    forwardRef(() => ThreadsModule),
  ],
  controllers: [WebhooksController],
  providers: [
    IngestionService,
    EmailParser,
    SmsParser,
    WhatsAppParser,
    OrganizationResolver,
    CustomerResolver,
    TicketResolver,
    PendingReviewService,
  ],
  exports: [IngestionService, PendingReviewService],
})
export class IngestionModule {}

