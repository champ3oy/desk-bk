import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsMongoId } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class TicketPaginationDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by priority' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ description: 'Filter by assigned user' })
  @IsOptional()
  @IsMongoId()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Filter by assigned group' })
  @IsOptional()
  @IsString()
  assignedToGroupId?: string;

  @ApiPropertyOptional({ description: 'Filter by customer ID' })
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Filter by sentiment' })
  @IsOptional()
  @IsString()
  sentiment?: string;

  @ApiPropertyOptional({
    description: 'Search tickets by subject, description or customer',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by predefined folder views',
    example: 'your_unsolved',
  })
  @IsOptional()
  @IsString()
  folder?: string;
}
