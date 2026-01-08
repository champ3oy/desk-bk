import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SocialIntegrationController } from './social-integration.controller';
import { SocialIntegrationService } from './social-integration.service';
import {
  SocialIntegration,
  SocialIntegrationSchema,
} from './entities/social-integration.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SocialIntegration.name, schema: SocialIntegrationSchema },
    ]),
  ],
  controllers: [SocialIntegrationController],
  providers: [SocialIntegrationService],
  exports: [SocialIntegrationService],
})
export class SocialIntegrationModule {}
