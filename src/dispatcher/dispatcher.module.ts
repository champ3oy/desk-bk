import { Module, forwardRef } from '@nestjs/common';
import { DispatcherService } from './dispatcher.service';
import { EmailIntegrationModule } from '../integrations/email/email-integration.module';
import { CustomersModule } from '../customers/customers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    EmailIntegrationModule,
    forwardRef(() => CustomersModule),
    OrganizationsModule,
    UsersModule,
  ],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
