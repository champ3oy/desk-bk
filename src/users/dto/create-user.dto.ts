import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  IsMongoId,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../entities/user.entity';

export class OrganizationMembershipDto {
  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  organizationId: string;

  @ApiProperty({
    description: 'User role',
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  @IsEnum(UserRole)
  role: UserRole;
}

export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
  })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({
    description:
      'Organization ID (required when creating users in an organization)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'User role',
    enum: UserRole,
    example: UserRole.CUSTOMER,
    default: UserRole.CUSTOMER,
  })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

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
}
