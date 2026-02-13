import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EmailIntegrationController } from './email-integration.controller';
import { EmailIntegrationService } from './email-integration.service';
import { GmailPollingService } from './gmail-polling.service';
import { OutlookPollingService } from './outlook-polling.service';
import { IngestionModule } from '../../ingestion/ingestion.module';
import { OrganizationsModule } from '../../organizations/organizations.module';
import {
  EmailIntegration,
  EmailIntegrationSchema,
} from './entities/email-integration.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailIntegration.name, schema: EmailIntegrationSchema },
    ]),
    ConfigModule,
    forwardRef(() => IngestionModule),
    OrganizationsModule,
    BullModule.registerQueue({
      name: 'email-ingestion',
    }),
  ],
  controllers: [EmailIntegrationController],
  providers: [
    EmailIntegrationService,
    GmailPollingService,
    OutlookPollingService,
  ],
  exports: [
    EmailIntegrationService,
    GmailPollingService,
    OutlookPollingService,
  ],
})
export class EmailIntegrationModule {}
