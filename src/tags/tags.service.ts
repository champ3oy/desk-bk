import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tag, TagDocument } from './entities/tag.entity';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(
    @InjectModel(Tag.name)
    private tagModel: Model<TagDocument>,
  ) {}

  async create(createTagDto: CreateTagDto): Promise<Tag> {
    const existingTag = await this.tagModel.findOne({
      name: createTagDto.name,
    });

    if (existingTag) {
      throw new ConflictException('Tag with this name already exists');
    }

    const tag = new this.tagModel(createTagDto);
    return tag.save();
  }

  async findAll(): Promise<Tag[]> {
    return this.tagModel.find().exec();
  }

  async findOne(id: string): Promise<Tag> {
    const tag = await this.tagModel.findById(id).exec();

    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found`);
    }

    return tag;
  }

  async update(id: string, updateTagDto: UpdateTagDto): Promise<Tag> {
    const tag = await this.tagModel.findById(id).exec();

    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found`);
    }

    if (updateTagDto.name && updateTagDto.name !== tag.name) {
      const existingTag = await this.tagModel.findOne({
        name: updateTagDto.name,
      });

      if (existingTag) {
        throw new ConflictException('Tag with this name already exists');
      }
    }

    Object.assign(tag, updateTagDto);
    return tag.save();
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.tagModel.findByIdAndDelete(id).exec();
  }
}

