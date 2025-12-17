import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TrainingSource,
  TrainingSourceDocument,
} from './entities/training-source.entity';
import { CreateTrainingSourceDto } from './dto/create-training-source.dto';

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(TrainingSource.name)
    private trainingSourceModel: Model<TrainingSourceDocument>,
  ) {}

  async create(
    createTrainingSourceDto: CreateTrainingSourceDto,
    organizationId: string,
  ): Promise<TrainingSource> {
    const createdSource = new this.trainingSourceModel({
      ...createTrainingSourceDto,
      organizationId: new Types.ObjectId(organizationId),
    });
    return createdSource.save();
  }

  async findAll(organizationId: string): Promise<TrainingSource[]> {
    return this.trainingSourceModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string, organizationId: string): Promise<TrainingSource> {
    const source = await this.trainingSourceModel.findOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!source) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }

    return source;
  }

  async update(
    id: string,
    updateDto: Partial<CreateTrainingSourceDto>,
    organizationId: string,
  ): Promise<TrainingSource> {
    const source = await this.trainingSourceModel.findOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!source) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }

    Object.assign(source, updateDto);
    return source.save();
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.trainingSourceModel.deleteOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }
  }
}
