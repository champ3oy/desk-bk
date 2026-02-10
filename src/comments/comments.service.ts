import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './entities/comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Ticket, TicketDocument } from '../tickets/entities/ticket.entity';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private commentModel: Model<CommentDocument>,
    @InjectModel(Ticket.name)
    private ticketModel: Model<TicketDocument>,
  ) {}

  async create(
    createCommentDto: CreateCommentDto,
    userId: string,
  ): Promise<Comment> {
    const ticket = await this.ticketModel
      .findById(createCommentDto.ticketId)
      .exec();

    if (!ticket) {
      throw new NotFoundException(
        `Ticket with ID ${createCommentDto.ticketId} not found`,
      );
    }

    const comment = new this.commentModel({
      ...createCommentDto,
      authorId: new Types.ObjectId(userId),
      ticketId: new Types.ObjectId(createCommentDto.ticketId),
      isInternal: createCommentDto.isInternal || false,
    });

    return comment.save();
  }

  async findAll(
    ticketId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<Comment[]> {
    const ticket = await this.ticketModel.findById(ticketId).exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${ticketId} not found`);
    }

    // Only agents and admins can view comments
    // Customers are external parties and don't have platform accounts
    const query: any = { ticketId: new Types.ObjectId(ticketId) };

    // Agents can only see non-internal comments, admins see all
    // Agents/Light Agents see all comments (internal and external)
    // if (userRole === UserRole.AGENT) {
    //   query.isInternal = false;
    // }

    return this.commentModel
      .find(query)
      .populate('authorId', 'email firstName lastName')
      .exec();
  }

  async findOne(
    id: string,
    userId: string,
    userRole: UserRole,
  ): Promise<CommentDocument> {
    const comment = await this.commentModel
      .findById(id)
      .populate('authorId', 'email firstName lastName')
      .populate('ticketId')
      .exec();

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    // Only agents and admins can view comments
    // Customers are external parties and don't have platform accounts
    // if (userRole === UserRole.AGENT && comment.isInternal) {
    //   throw new ForbiddenException('You do not have permission to view this comment');
    // }

    return comment;
  }

  async update(
    id: string,
    updateCommentDto: UpdateCommentDto,
    userId: string,
    userRole: UserRole,
  ): Promise<Comment> {
    const comment = await this.findOne(id, userId, userRole);

    if (
      (comment.authorId as any)._id?.toString() !== userId &&
      userRole !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    Object.assign(comment, updateCommentDto);
    return comment.save();
  }

  async remove(id: string, userId: string, userRole: UserRole): Promise<void> {
    const comment = await this.findOne(id, userId, userRole);

    if (
      (comment.authorId as any)._id?.toString() !== userId &&
      userRole !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.commentModel.findByIdAndDelete(id).exec();
  }
}
