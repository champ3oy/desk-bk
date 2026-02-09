import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PendingReview,
  PendingReviewDocument,
  PendingReviewStatus,
} from '../entities/pending-review.entity';
import { IncomingMessageDto } from '../dto/incoming-message.dto';

@Injectable()
export class PendingReviewService {
  private readonly logger = new Logger(PendingReviewService.name);

  constructor(
    @InjectModel(PendingReview.name)
    private pendingReviewModel: Model<PendingReviewDocument>,
  ) {}

  /**
   * Create a pending review entry for messages that couldn't be processed
   */
  async create(
    message: IncomingMessageDto,
    reason: string,
    rawPayload: Record<string, any>,
  ): Promise<PendingReviewDocument> {
    const pendingReview = new this.pendingReviewModel({
      channel: message.channel,
      reason,
      rawMessage: rawPayload,
      senderEmail: message.senderEmail,
      senderPhone: message.senderPhone,
      recipientEmail: message.recipientEmail,
      recipientPhone: message.recipientPhone,
      content: message.content,
      status: PendingReviewStatus.PENDING,
    });

    const saved = await pendingReview.save();
    this.logger.warn(
      `Created pending review ${saved._id} for message: ${reason}`,
    );
    return saved;
  }

  /**
   * Get all pending reviews
   */
  async findAll(
    status?: PendingReviewStatus,
  ): Promise<PendingReviewDocument[]> {
    const query: any = {};
    if (status) {
      query.status = status;
    }
    return this.pendingReviewModel.find(query).sort({ createdAt: -1 }).exec();
  }

  /**
   * Get a pending review by ID
   */
  async findOne(id: string): Promise<PendingReviewDocument | null> {
    return this.pendingReviewModel.findById(id).exec();
  }

  /**
   * Resolve a pending review (manually assign to organization)
   */
  async resolve(
    id: string,
    organizationId: string,
    notes?: string,
  ): Promise<PendingReviewDocument> {
    const pendingReview = await this.findOne(id);
    if (!pendingReview) {
      throw new Error(`Pending review ${id} not found`);
    }

    pendingReview.status = PendingReviewStatus.RESOLVED;
    pendingReview.resolvedOrganizationId = organizationId;
    if (notes) {
      pendingReview.notes = notes;
    }

    return pendingReview.save();
  }

  /**
   * Mark a pending review as ignored
   */
  async ignore(id: string, notes?: string): Promise<PendingReviewDocument> {
    const pendingReview = await this.findOne(id);
    if (!pendingReview) {
      throw new Error(`Pending review ${id} not found`);
    }

    pendingReview.status = PendingReviewStatus.IGNORED;
    if (notes) {
      pendingReview.notes = notes;
    }

    return pendingReview.save();
  }
}
