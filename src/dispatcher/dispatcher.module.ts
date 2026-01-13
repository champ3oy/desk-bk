import { Module, forwardRef } from '@nestjs/common';
import { DispatcherService } from './dispatcher.service';
import { EmailIntegrationModule } from '../integrations/email/email-integration.module';
import { CustomersModule } from '../customers/customers.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    EmailIntegrationModule,
    forwardRef(() => CustomersModule),
    OrganizationsModule,
  ],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
