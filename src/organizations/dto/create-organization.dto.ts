import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'Organization name',
    example: 'Acme Corporation',
  })
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Organization slug',
    example: 'acme-corp',
  })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply using draft responses is enabled',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  @IsOptional()
  aiAutoReplyEmail?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for social media',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  aiAutoReplySocialMedia?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for live chat',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  aiAutoReplyLiveChat?: boolean;

  @ApiPropertyOptional({
    description: 'Confidence threshold for auto-replies',
    example: 85,
  })
  @IsOptional()
  aiConfidenceThreshold?: number;

  @ApiPropertyOptional({
    description: 'Restricted topics',
    example: ['Billing'],
  })
  @IsOptional()
  aiRestrictedTopics?: string[];

  @ApiPropertyOptional({
    description: 'Learn from tickets',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  aiLearnFromTickets?: boolean;
}
