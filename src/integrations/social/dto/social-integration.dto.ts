import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { SocialProvider } from '../entities/social-integration.entity';

export class ExchangeWhatsAppCodeDto {
  @ApiProperty({ description: 'Authorization code from Facebook OAuth' })
  @IsString()
  code: string;

  @ApiPropertyOptional({
    description: 'Redirect URI used during authorization',
  })
  @IsString()
  @IsOptional()
  redirectUri?: string;
}

export class StoreWabaDataDto {
  @ApiProperty({ description: 'WhatsApp Business Account ID' })
  @IsString()
  wabaId: string;

  @ApiPropertyOptional({ description: 'Facebook Business ID' })
  @IsString()
  @IsOptional()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Phone Number ID' })
  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  @ApiPropertyOptional({ description: 'Event type from embedded signup' })
  @IsString()
  @IsOptional()
  event?: string;

  @ApiPropertyOptional({
    description: 'Two-step verification PIN for the phone number',
  })
  @IsString()
  @IsOptional()
  pin?: string;
}

export class ExchangeInstagramCodeDto {
  @ApiProperty({ description: 'Authorization code from Facebook OAuth' })
  @IsString()
  code: string;

  @ApiPropertyOptional({
    description: 'Redirect URI used during authorization',
  })
  @IsString()
  @IsOptional()
  redirectUri?: string;
}

export class StoreInstagramDataDto {
  @ApiProperty({ description: 'Instagram Account ID' })
  @IsString()
  instagramAccountId: string;

  @ApiPropertyOptional({ description: 'Instagram Username' })
  @IsString()
  @IsOptional()
  instagramUsername?: string;

  @ApiPropertyOptional({ description: 'Facebook Page ID linked to Instagram' })
  @IsString()
  @IsOptional()
  facebookPageId?: string;
}

export class SocialCallbackDto {
  @ApiProperty({ description: 'Provider type', enum: SocialProvider })
  @IsEnum(SocialProvider)
  provider: SocialProvider;

  @ApiProperty({ description: 'Authorization code from OAuth flow' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: 'Redirect URI' })
  @IsString()
  @IsOptional()
  redirectUri?: string;

  @ApiPropertyOptional({ description: 'State parameter for CSRF protection' })
  @IsString()
  @IsOptional()
  state?: string;
}
