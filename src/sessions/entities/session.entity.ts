import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type SessionDocument = Session & Document;

@Schema({ timestamps: true })
export class Session {
  @ApiProperty({ description: 'User ID', example: '507f1f77bcf86cd799439011' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @ApiProperty({
    description: 'Device/User Agent info',
    example: 'Chrome on MacBook Pro',
  })
  @Prop({ required: true })
  device: string;

  @ApiProperty({ description: 'IP Address', example: '192.168.1.1' })
  @Prop({ required: true })
  ip: string;

  @ApiProperty({
    description: 'Last active timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Prop({ default: Date.now })
  lastActive: Date;

  @ApiProperty({ description: 'Session expiration timestamp' })
  @Prop({ required: true })
  expiresAt: Date;

  @ApiProperty({
    description: 'Refresh token hash (for revocation)',
    required: false,
  })
  @Prop({ select: false })
  refreshTokenHash?: string;

  @ApiProperty({
    description: 'Is current session (computed)',
    required: false,
  })
  isCurrent?: boolean; // Virtual field not stored in DB
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ userId: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
