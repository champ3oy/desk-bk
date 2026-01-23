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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrainingSource.name, schema: TrainingSourceSchema },
    ]),
    ConfigModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService, ScraperService],
  exports: [TrainingService, ScraperService],
})
export class TrainingModule {}
