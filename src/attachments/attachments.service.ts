import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attachment, AttachmentDocument } from './entities/attachment.entity';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { Ticket, TicketDocument } from '../tickets/entities/ticket.entity';
import { Comment, CommentDocument } from '../comments/entities/comment.entity';

import { StorageService } from '../storage/storage.service';

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectModel(Attachment.name)
    private attachmentModel: Model<AttachmentDocument>,
    @InjectModel(Ticket.name)
    private ticketModel: Model<TicketDocument>,
    @InjectModel(Comment.name)
    private commentModel: Model<CommentDocument>,
    private storageService: StorageService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    organizationId: string,
    ticketId?: string,
  ): Promise<Attachment> {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      throw new Error(
        `Invalid Organization ID provided: "${organizationId}". It must be a 24-character hex string.`,
      );
    }
    const uploadedFile = await this.storageService.saveFile(
      file.originalname,
      file.buffer,
      file.mimetype,
    );

    const attachmentData: any = {
      filename: uploadedFile.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: uploadedFile.size,
      path: uploadedFile.path,
      organizationId: new Types.ObjectId(organizationId),
    };

    if (ticketId) {
      try {
        attachmentData.ticketId = new Types.ObjectId(ticketId);
      } catch (e) {
        console.warn(`Invalid ticketId provided: ${ticketId}`);
        // Skip setting ticketId if invalid
      }
    }

    const attachment = new this.attachmentModel(attachmentData);
    return attachment.save();
  }

  async create(
    createAttachmentDto: CreateAttachmentDto,
    organizationId: string,
  ): Promise<Attachment> {
    if (!organizationId) {
      throw new Error('organizationId is required');
    }
    if (createAttachmentDto.ticketId) {
      const ticket = await this.ticketModel
        .findById(createAttachmentDto.ticketId)
        .exec();
      if (!ticket) {
        throw new NotFoundException(
          `Ticket with ID ${createAttachmentDto.ticketId} not found`,
        );
      }
    }

    if (createAttachmentDto.commentId) {
      const comment = await this.commentModel
        .findById(createAttachmentDto.commentId)
        .exec();
      if (!comment) {
        throw new NotFoundException(
          `Comment with ID ${createAttachmentDto.commentId} not found`,
        );
      }
    }

    const attachmentData: any = {
      ...createAttachmentDto,
      size: parseInt(createAttachmentDto.size, 10),
      organizationId: new Types.ObjectId(organizationId),
    };

    if (createAttachmentDto.ticketId) {
      try {
        attachmentData.ticketId = new Types.ObjectId(
          createAttachmentDto.ticketId,
        );
      } catch (e) {
        console.warn(
          `Invalid ticketId provided: ${createAttachmentDto.ticketId}`,
        );
      }
    }

    if (createAttachmentDto.commentId) {
      try {
        attachmentData.commentId = new Types.ObjectId(
          createAttachmentDto.commentId,
        );
      } catch (e) {
        console.warn(
          `Invalid commentId provided: ${createAttachmentDto.commentId}`,
        );
      }
    }

    const attachment = new this.attachmentModel(attachmentData);
    return attachment.save();
  }

  async findAll(ticketId?: string, commentId?: string): Promise<Attachment[]> {
    const query: any = {};

    if (ticketId) {
      query.ticketId = new Types.ObjectId(ticketId);
    }

    if (commentId) {
      query.commentId = new Types.ObjectId(commentId);
    }

    return this.attachmentModel
      .find(query)
      .populate('ticketId')
      .populate('commentId')
      .exec();
  }

  async findOne(id: string): Promise<Attachment> {
    const attachment = await this.attachmentModel
      .findById(id)
      .populate('ticketId')
      .populate('commentId')
      .exec();

    if (!attachment) {
      throw new NotFoundException(`Attachment with ID ${id} not found`);
    }

    return attachment;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.attachmentModel.findByIdAndDelete(id).exec();
  }
}
