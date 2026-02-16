import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CustomerPaginationDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status (active/churned)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by mood' })
  @IsOptional()
  @IsString()
  mood?: string;

  @ApiPropertyOptional({ description: 'Filter by industry' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({
    description: 'Search customers by name, email or company',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
