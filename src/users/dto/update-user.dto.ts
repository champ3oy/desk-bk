import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsMongoId,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../entities/user.entity';
import { OrganizationMembershipDto } from './create-user.dto';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'User password',
    example: 'newpassword123',
  })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({
    description: 'User first name',
    example: 'John',
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'User last name',
    example: 'Doe',
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'User role',
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'Organizations memberships',
    type: [OrganizationMembershipDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrganizationMembershipDto)
  @IsOptional()
  organizations?: OrganizationMembershipDto[];

  @ApiPropertyOptional({
    description: 'Whether the user is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+1 (555) 123-4567',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Company name',
    example: 'Acme Corp',
  })
  @IsString()
  @IsOptional()
  company?: string;

  @ApiPropertyOptional({
    description: 'Job title',
    example: 'Support Manager',
  })
  @IsString()
  @IsOptional()
  jobTitle?: string;

  @ApiPropertyOptional({
    description: 'Location',
    example: 'San Francisco, CA',
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  notifications?: {
    email: boolean;
    desktop: boolean;
    digest: string;
  };

  @ApiPropertyOptional()
  @IsOptional()
  regional?: {
    language: string;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
  };

  @ApiPropertyOptional()
  @IsOptional()
  signature?: {
    text: string;
    imageUrl: string;
    enabled: boolean;
  };

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  twoFactorEnabled?: boolean;
}
