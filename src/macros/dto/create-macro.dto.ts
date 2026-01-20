import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { MacroVisibility } from '../entities/macro.entity';

export class CreateMacroDto {
  @ApiProperty({
    description: 'Macro title',
    example: 'Welcome New Customer',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Title must be at least 3 characters' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title: string;

  @ApiProperty({
    description: 'Shortcut trigger (must start with /)',
    example: '/welcome',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Shortcut must be at least 2 characters' })
  @MaxLength(50, { message: 'Shortcut must not exceed 50 characters' })
  @Matches(/^\/[a-z0-9-_]+$/i, {
    message:
      'Shortcut must start with / and contain only letters, numbers, hyphens, and underscores',
  })
  shortcut: string;

  @ApiProperty({
    description: 'Macro content/message',
    example: 'Hello! Welcome to our support. How can I help you today?',
    minLength: 10,
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Content must be at least 10 characters' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  content: string;

  @ApiPropertyOptional({
    description: 'Visibility level',
    enum: MacroVisibility,
    example: MacroVisibility.PRIVATE,
    default: MacroVisibility.PRIVATE,
  })
  @IsEnum(MacroVisibility)
  @IsOptional()
  visibility?: MacroVisibility;

  @ApiPropertyOptional({
    description: 'Team IDs to share with (for team visibility)',
    example: ['507f1f77bcf86cd799439011'],
  })
  @IsArray()
  @IsOptional()
  sharedWithTeams?: string[];
}
