import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElevenLabsService } from './elevenlabs.service';
import { OrganizationsModule } from '../../organizations/organizations.module';

import { ElevenLabsController } from './elevenlabs.controller';

@Module({
  imports: [ConfigModule, forwardRef(() => OrganizationsModule)],
  controllers: [ElevenLabsController],
  providers: [ElevenLabsService],
  exports: [ElevenLabsService],
})
export class ElevenLabsModule {}
