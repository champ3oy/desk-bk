import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class WebhookPayloadDto {
  @ApiProperty({ description: 'Webhook provider identifier', example: 'sendgrid' })
  @IsString()
  provider: string;

  @ApiPropertyOptional({ description: 'Webhook signature for verification' })
  @IsString()
  @IsOptional()
  signature?: string;

  @ApiPropertyOptional({ description: 'Webhook ID for verification' })
  @IsString()
  @IsOptional()
  webhookId?: string;

  @ApiProperty({ description: 'Raw webhook payload', additionalProperties: true })
  @IsObject()
  payload: Record<string, any>;
}

