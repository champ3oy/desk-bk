import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UserRole {
  CUSTOMER = 'customer',
  AGENT = 'agent',
  ADMIN = 'admin',
}

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
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: false })
  organizationId?: Types.ObjectId;

  @ApiProperty({
    description: 'Whether user is active',
    example: true,
  })
  @Prop({ default: true })
  isActive: boolean;

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
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  organizationId?: string;

  @ApiProperty({
    description: 'Whether user is active',
    example: true,
  })
  isActive: boolean;

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
}
