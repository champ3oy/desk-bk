import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UserRole {
  CUSTOMER = 'customer',
  AGENT = 'agent',
  LIGHT_AGENT = 'light_agent',
  ADMIN = 'admin',
}

export enum UserStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  AWAY = 'away',
  BUSY = 'busy',
  DND = 'dnd',
}

@Schema({ _id: false })
export class OrganizationMembership {
  @ApiProperty({ description: 'Organization ID', type: String })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @ApiProperty({ description: 'User role in the organization', enum: UserRole })
  @Prop({ type: String, enum: UserRole, required: true })
  role: UserRole;
}
export const OrganizationMembershipSchema = SchemaFactory.createForClass(
  OrganizationMembership,
);

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @ApiProperty({ description: 'User email', example: 'user@example.com' })
  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @ApiProperty({ description: 'First name', example: 'John' })
  @Prop({ required: true })
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Doe' })
  @Prop({ required: true })
  lastName: string;

  @ApiProperty({
    description: 'User role',
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @ApiPropertyOptional({
    description: 'User availability status',
    enum: UserStatus,
    example: UserStatus.ONLINE,
  })
  @Prop({
    type: String,
    enum: UserStatus,
    default: UserStatus.OFFLINE, // Default to offline
  })
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: false })
  organizationId?: Types.ObjectId;

  @ApiProperty({
    description: 'Organizations memberships',
    type: [OrganizationMembership],
  })
  @Prop({ type: [OrganizationMembershipSchema], default: [] })
  organizations: OrganizationMembership[];

  @ApiProperty({
    description: 'Whether user is active',
    example: true,
  })
  @Prop({ default: true })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+1 (555) 123-4567',
  })
  @Prop()
  phone?: string;

  @ApiPropertyOptional({ description: 'Company name', example: 'Acme Corp' })
  @Prop()
  company?: string;

  @ApiPropertyOptional({ description: 'Job title', example: 'Support Manager' })
  @Prop()
  jobTitle?: string;

  @ApiPropertyOptional({
    description: 'Location',
    example: 'San Francisco, CA',
  })
  @Prop()
  location?: string;

  @ApiPropertyOptional({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;

  @ApiPropertyOptional({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt?: Date;
  @ApiPropertyOptional({
    description: 'Notification preferences',
    example: { email: true, desktop: false, digest: 'daily' },
  })
  @Prop({
    type: {
      email: { type: Boolean, default: true },
      desktop: { type: Boolean, default: true },
      digest: { type: String, default: 'daily' }, // 'daily', 'weekly', 'never'
    },
    default: { email: true, desktop: true, digest: 'daily' },
  })
  notifications?: {
    email: boolean;
    desktop: boolean;
    digest: string;
  };

  @ApiPropertyOptional({
    description: 'Regional preferences',
    example: {
      language: 'en',
      timezone: 'UTC',
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12h',
    },
  })
  @Prop({
    type: {
      language: { type: String, default: 'en' },
      timezone: { type: String, default: 'UTC' },
      dateFormat: { type: String, default: 'MM/DD/YYYY' },
      timeFormat: { type: String, default: '12h' },
    },
    default: {
      language: 'en',
      timezone: 'UTC',
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12h',
    },
  })
  regional?: {
    language: string;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
  };

  @ApiPropertyOptional({
    description: 'Agent email signature',
    example: {
      text: 'Best regards, Agent',
      imageUrl: 'http...',
      enabled: true,
    },
  })
  @Prop({
    type: {
      text: { type: String, default: '' },
      imageUrl: { type: String, default: '' },
      enabled: { type: Boolean, default: true },
    },
    default: { text: '', imageUrl: '', enabled: true },
  })
  signature?: {
    text: string;
    imageUrl: string;
    enabled: boolean;
  };

  @ApiPropertyOptional({
    description: 'Whether 2FA is enabled',
    example: false,
  })
  @Prop({ default: false })
  twoFactorEnabled?: boolean;

  @ApiPropertyOptional({
    description: '2FA Secret (internal use only)',
  })
  @Prop({ select: false }) // Do not return by default
  twoFactorSecret?: string;

  @Prop({ select: false })
  resetPasswordOTP?: string;

  @Prop({ select: false })
  resetPasswordOTPExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Create compound index for email uniqueness within organization
UserSchema.index({ email: 1, organizationId: 1 }, { unique: true });

// Response type without password (for service return types)
export type UserResponse = Omit<User, 'password'>;

// Response DTO class for Swagger documentation (without password)
export class UserResponseDto {
  @ApiProperty({ description: 'User ID', example: '507f1f77bcf86cd799439011' })
  _id?: string;

  @ApiProperty({ description: 'User email', example: 'user@example.com' })
  email: string;

  @ApiProperty({ description: 'First name', example: 'John' })
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Doe' })
  lastName: string;

  @ApiProperty({
    description: 'User role',
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  role: UserRole;

  @ApiPropertyOptional({
    description: 'User availability status',
    enum: UserStatus,
    example: UserStatus.ONLINE,
  })
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  organizationId?: string;

  @ApiProperty({
    description: 'Organizations memberships',
    type: [OrganizationMembership],
  })
  organizations: OrganizationMembership[];

  @ApiProperty({
    description: 'Whether user is active',
    example: true,
  })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+1 (555) 123-4567',
  })
  phone?: string;

  @ApiPropertyOptional({ description: 'Company name', example: 'Acme Corp' })
  company?: string;

  @ApiPropertyOptional({ description: 'Job title', example: 'Support Manager' })
  jobTitle?: string;

  @ApiPropertyOptional({
    description: 'Location',
    example: 'San Francisco, CA',
  })
  location?: string;

  @ApiPropertyOptional({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;

  @ApiPropertyOptional({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt?: Date;

  @ApiPropertyOptional()
  notifications?: {
    email: boolean;
    desktop: boolean;
    digest: string;
  };

  @ApiPropertyOptional()
  regional?: {
    language: string;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
  };

  @ApiPropertyOptional()
  signature?: {
    text: string;
    imageUrl: string;
    enabled: boolean;
  };

  @ApiPropertyOptional()
  twoFactorEnabled?: boolean;
}
