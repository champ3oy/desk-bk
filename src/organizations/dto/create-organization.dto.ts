import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'Organization name',
    example: 'Acme Corporation',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Organization description',
    example: 'A leading technology company',
  })
  @IsString()
  @IsOptional()
  description?: string;
}

