import { Module } from '@nestjs/common';
import { EmailIntegrationModule } from './email/email-integration.module';

@Module({
  imports: [EmailIntegrationModule],
  exports: [EmailIntegrationModule],
})
export class IntegrationsModule {}
