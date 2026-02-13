import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsArray,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class UpdateResponseConfigDto {
  @ApiPropertyOptional({
    description: 'Whether AI should learn from closed tickets',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiLearnFromTickets?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for email',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  aiAutoReplyEmail?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for social media',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  aiAutoReplySocialMedia?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for live chat',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiAutoReplyLiveChat?: boolean;

  @ApiPropertyOptional({
    description: 'Confidence threshold for auto-replies (0-100)',
    example: 85,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  aiConfidenceThreshold?: number;

  @ApiPropertyOptional({
    description: 'Topics that AI should not respond to automatically',
    example: ['Billing', 'Legal Issues', 'Refunds'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  aiRestrictedTopics?: string[];

  @ApiPropertyOptional({
    description: 'Email signature for AI auto-replies',
    example: 'Best regards,\nAI Support Agent',
  })
  @IsOptional()
  @IsString()
  aiEmailSignature?: string;

  @ApiPropertyOptional({
    description:
      'Whether tickets should be automatically closed after inactivity',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  autoCloseEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Number of hours of inactivity before auto-closing a ticket',
    example: 72,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  autoCloseDelayHours?: number;
}
