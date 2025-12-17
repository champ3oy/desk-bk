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

  @ApiPropertyOptional({ description: 'Filter by customer ID' })
  @IsOptional()
  @IsMongoId()
  customerId?: string;
}
