import { Module, forwardRef } from '@nestjs/common';
import { DispatcherService } from './dispatcher.service';
import { EmailIntegrationModule } from '../integrations/email/email-integration.module';
import { CustomersModule } from '../customers/customers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { ThreadsModule } from '../threads/threads.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from '../threads/entities/message.entity';
import { Thread, ThreadSchema } from '../threads/entities/thread.entity';

import { SocialIntegrationModule } from '../integrations/social/social-integration.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Thread.name, schema: ThreadSchema },
    ]),
    forwardRef(() => EmailIntegrationModule),
    forwardRef(() => SocialIntegrationModule),
    forwardRef(() => CustomersModule),
    forwardRef(() => ThreadsModule),
    OrganizationsModule,
    UsersModule,
  ],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
