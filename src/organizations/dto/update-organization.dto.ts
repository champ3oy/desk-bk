import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    description: 'Organization name',
    example: 'Acme Corporation',
  })
  @IsString()
  @IsOptional()
  name?: string;

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
    description: 'Default agent ID for auto-assignment of new tickets',
    example: '69428c5a0f12a7ddc46b49b5',
  })
  @IsString()
  @IsOptional()
  defaultAgentId?: string;

  @ApiPropertyOptional({
    description: 'Default group/team ID for auto-assignment of new tickets',
    example: '69428c5a0f12a7ddc46b49b5',
  })
  @IsString()
  @IsOptional()
  defaultGroupId?: string;

  @ApiPropertyOptional({
    description: 'Whether the organization is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply using draft responses is enabled',
    example: false,
  })
  @IsBoolean()
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
  @IsNumber()
  @IsOptional()
  aiConfidenceThreshold?: number;

  @ApiPropertyOptional({
    description: 'Restricted topics',
    example: ['Billing'],
  })
  @IsArray()
  @IsOptional()
  aiRestrictedTopics?: string[];

  @ApiPropertyOptional({
    description: 'Learn from tickets',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  aiLearnFromTickets?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  aiPersonalityPrompt?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  aiFormality?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  aiResponseLength?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  aiEmpathy?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  aiUseEmojis?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  aiIncludeGreetings?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  aiIncludeSignOff?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  aiWordsToUse?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  aiWordsToAvoid?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  plan?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  billingEmail?: string;

  @ApiPropertyOptional({
    description: 'ElevenLabs Agent ID',
    example: 'agent_abc123',
  })
  @IsString()
  @IsOptional()
  elevenLabsAgentId?: string;

  @ApiPropertyOptional({
    description: 'Widget configuration',
  })
  @IsOptional()
  widgetConfig?: {
    primaryColor?: string;
    secondaryColor?: string;
    position?: string;
    size?: string;
    borderRadius?: string;
    logoUrl?: string;
    customCSS?: string;
    welcomeMessage?: string;
    headerText?: string;
  };

  @ApiPropertyOptional({
    description: 'Business hours for the organization',
  })
  @IsArray()
  @IsOptional()
  businessHours?: {
    day: string;
    open: string;
    close: string;
    closed: boolean;
  }[];

  @ApiPropertyOptional({
    description: 'Organization timezone',
    example: 'UTC',
  })
  @IsString()
  @IsOptional()
  timezone?: string;
}
