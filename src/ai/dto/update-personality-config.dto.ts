import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class UpdatePersonalityConfigDto {
  @ApiPropertyOptional({
    description: 'AI personality system prompt',
    example: 'You are a helpful and friendly customer support assistant...',
  })
  @IsOptional()
  @IsString()
  aiPersonalityPrompt?: string;

  @ApiPropertyOptional({
    description:
      'AI formality level (0-100, where 0 is casual and 100 is formal)',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  aiFormality?: number;

  @ApiPropertyOptional({
    description: 'AI empathy level (0-100)',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  aiEmpathy?: number;

  @ApiPropertyOptional({
    description: 'AI response verbosity/length (0-100)',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  aiResponseLength?: number;

  @ApiPropertyOptional({
    description: 'Whether to use emojis in AI responses',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiUseEmojis?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to include greetings in AI responses',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiIncludeGreetings?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to include sign-off in AI responses',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiIncludeSignOff?: boolean;

  @ApiPropertyOptional({
    description: 'Comma-separated list of words/phrases to use in AI responses',
    example: 'Happy to help, Absolutely, Great question',
  })
  @IsOptional()
  @IsString()
  aiWordsToUse?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated list of words/phrases to avoid in AI responses',
    example: "No problem, Just, I don't know",
  })
  @IsOptional()
  @IsString()
  aiWordsToAvoid?: string;
}
