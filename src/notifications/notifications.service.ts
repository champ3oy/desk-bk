import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async create(
    createNotificationDto: CreateNotificationDto,
  ): Promise<Notification> {
    const createdNotification = new this.notificationModel(
      createNotificationDto,
    );
    const saved = await createdNotification.save();
    console.log(
      `[NotificationsService] Created notification for user ${createNotificationDto.userId}: ${createNotificationDto.title}`,
    );

    // Real-time update
    this.notificationsGateway.sendToUser(
      createNotificationDto.userId.toString(),
      'custom_notification',
      saved,
    );

    return saved;
  }

  async findAll(userId: string): Promise<Notification[]> {
    console.log(`[NotificationsService] Finding all for user: ${userId}`);
    const oid = new Types.ObjectId(userId);
    return this.notificationModel
      .find({
        $or: [{ userId: oid }, { userId: userId }],
        read: false,
      })
      .sort({ createdAt: -1 })
      .limit(50) // Limit to last 50 notifications
      .exec();
  }

  async getUnreadCount(userId: string): Promise<number> {
    const oid = new Types.ObjectId(userId);
    return this.notificationModel.countDocuments({
      $or: [{ userId: oid }, { userId: userId }],
      read: false,
    });
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const oid = new Types.ObjectId(userId);
    return this.notificationModel
      .findOneAndUpdate(
        {
          _id: id,
          $or: [{ userId: oid }, { userId: userId }],
        },
        { read: true },
        { new: true },
      )
      .exec() as Promise<Notification>;
  }

  async markAllAsRead(userId: string): Promise<void> {
    const oid = new Types.ObjectId(userId);
    const result = await this.notificationModel
      .updateMany(
        {
          $or: [{ userId: oid }, { userId: userId }],
          read: false,
        },
        { read: true },
      )
      .exec();
    console.log(
      `[NotificationsService] Marked ${result.modifiedCount} notifications as read for user ${userId}`,
    );
  }
}
