import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsMongoId,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrainingSourceDto {
  @ApiProperty({
    description: 'Training source name',
    example: 'Product Manual',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Source type',
    enum: ['file', 'image', 'audio', 'text', 'url'],
    example: 'file',
  })
  @IsEnum(['file', 'image', 'audio', 'text', 'url'])
  type: string;

  @ApiPropertyOptional({
    description: 'Source content (text content or URL)',
    example: 'https://example.com/manual.pdf',
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({
    description: 'File size',
    example: '2.4 MB',
  })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsOptional()
  organizationId?: string;
}
