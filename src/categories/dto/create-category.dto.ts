import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name',
    example: 'Technical Support',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'Technical support related tickets',
  })
  @IsString()
  @IsOptional()
  description?: string;
}

