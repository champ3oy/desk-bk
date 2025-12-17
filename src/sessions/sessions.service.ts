import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from './entities/session.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  async create(
    userId: string,
    device: string,
    ip: string,
    refreshToken?: string,
  ): Promise<SessionDocument> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days active

    let refreshTokenHash;
    if (refreshToken) {
      refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    }

    const session = new this.sessionModel({
      userId: new Types.ObjectId(userId),
      device,
      ip,
      expiresAt,
      refreshTokenHash,
    });

    return session.save();
  }

  async findAll(userId: string): Promise<SessionDocument[]> {
    return this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ lastActive: -1 })
      .exec();
  }

  async revoke(id: string, userId: string): Promise<void> {
    await this.sessionModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
  }

  async removeCurrent(userId: string, currentSessionId: string): Promise<void> {
    await this.sessionModel.deleteOne({
      _id: new Types.ObjectId(currentSessionId),
      userId: new Types.ObjectId(userId),
    });
  }

  // To update last active
  async touch(id: string) {
    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { lastActive: new Date() } },
    );
  }
}
