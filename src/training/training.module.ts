import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import {
  TrainingSource,
  TrainingSourceSchema,
} from './entities/training-source.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrainingSource.name, schema: TrainingSourceSchema },
    ]),
  ],
  controllers: [TrainingController],
  providers: [TrainingService],
  exports: [TrainingService],
})
export class TrainingModule {}
