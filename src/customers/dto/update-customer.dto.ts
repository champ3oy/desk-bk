import {
  IsEmail,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class PhoneEntryDto {
  @IsString()
  number: string;

  @IsBoolean()
  @IsOptional()
  isWhatsApp?: boolean;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({
    description: 'Customer email address',
    example: 'customer@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'Customer first name',
    example: 'John',
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Customer last name',
    example: 'Doe',
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Customer phone number',
    example: '+1234567890',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Secondary email addresses',
    example: ['work@example.com', 'backup@example.com'],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  @IsOptional()
  secondaryEmails?: string[];

  @ApiPropertyOptional({
    description: 'Additional phone numbers with WhatsApp flag',
    example: [{ number: '+1234567890', isWhatsApp: true }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhoneEntryDto)
  @IsOptional()
  phones?: PhoneEntryDto[];

  @ApiPropertyOptional({
    description: 'Customer company name',
    example: 'Acme Corp',
  })
  @IsString()
  @IsOptional()
  company?: string;

  @ApiPropertyOptional({
    description: 'Whether the customer is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Internal notes about the customer',
    example: 'VIP customer',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
