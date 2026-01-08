import { Module } from '@nestjs/common';
import { EmailIntegrationModule } from './email/email-integration.module';
import { SocialIntegrationModule } from './social/social-integration.module';

@Module({
  imports: [EmailIntegrationModule, SocialIntegrationModule],
  exports: [EmailIntegrationModule, SocialIntegrationModule],
})
export class IntegrationsModule {}
