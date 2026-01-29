import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import { ScraperService } from './scraper.service';
import {
  TrainingSource,
  TrainingSourceSchema,
} from './entities/training-source.entity';
import { ElevenLabsModule } from '../integrations/elevenlabs/elevenlabs.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrainingSource.name, schema: TrainingSourceSchema },
    ]),
    ConfigModule,
    ElevenLabsModule,
    OrganizationsModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService, ScraperService],
  exports: [TrainingService, ScraperService],
})
export class TrainingModule {}
