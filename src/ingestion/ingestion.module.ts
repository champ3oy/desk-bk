import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { EmailIntegrationModule } from '../integrations/email/email-integration.module';
import { IngestionService } from './ingestion.service';
import { WebhooksController } from './webhooks.controller';
import { EmailParser } from './parsers/email.parser';
import { SmsParser } from './parsers/sms.parser';
import { WhatsAppParser } from './parsers/whatsapp.parser';
import { WidgetParser } from './parsers/widget.parser';
import { OrganizationResolver } from './resolvers/organization.resolver';
import { CustomerResolver } from './resolvers/customer.resolver';
import { TicketResolver } from './resolvers/ticket.resolver';
import { PendingReviewService } from './services/pending-review.service';
import { MessageQueueService } from './services/message-queue.service';
import {
  PendingReview,
  PendingReviewSchema,
} from './entities/pending-review.entity';
import { Message, MessageSchema } from '../threads/entities/message.entity';
import { Thread, ThreadSchema } from '../threads/entities/thread.entity';
import { Ticket, TicketSchema } from '../tickets/entities/ticket.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CustomersModule } from '../customers/customers.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ThreadsModule } from '../threads/threads.module';
import { TrainingModule } from '../training/training.module';
import { KnowledgeBaseService } from '../ai/knowledge-base.service';
import { UsersModule } from '../users/users.module';
import { AttachmentsModule } from '../attachments/attachments.module';

import { SocialIntegrationModule } from '../integrations/social/social-integration.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailIngestionProcessor } from './email-ingestion.processor';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PendingReview.name, schema: PendingReviewSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Thread.name, schema: ThreadSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    OrganizationsModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => TicketsModule),
    forwardRef(() => ThreadsModule),
    AttachmentsModule,
    TrainingModule, // For KnowledgeBaseService
    UsersModule,

    SocialIntegrationModule,
    forwardRef(() => EmailIntegrationModule),
    NotificationsModule,
    BullModule.registerQueue({
      name: 'email-ingestion',
    }),
  ],
  controllers: [WebhooksController],
  providers: [
    IngestionService,
    EmailParser,
    SmsParser,
    WhatsAppParser,
    WidgetParser,
    OrganizationResolver,
    CustomerResolver,
    TicketResolver,
    PendingReviewService,
    MessageQueueService,
    KnowledgeBaseService,
    EmailIngestionProcessor,
  ],
  exports: [IngestionService, PendingReviewService, MessageQueueService],
})
export class IngestionModule {}
