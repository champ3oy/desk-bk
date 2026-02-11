import {
  IsString,
  IsEnum,
  IsOptional,
  IsMongoId,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus, TicketPriority } from '../entities/ticket.entity';

export class CreateTicketDto {
  @ApiProperty({
    description: 'Ticket subject',
    example: 'Unable to login to account',
  })
  @IsString()
  subject: string;

  @ApiProperty({
    description: 'Ticket description',
    example:
      'I am unable to login to my account. I keep getting an error message.',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'ID of the customer creating this ticket',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  customerId: string;

  @ApiPropertyOptional({
    description: 'Ticket status',
    enum: TicketStatus,
    example: TicketStatus.OPEN,
    default: TicketStatus.OPEN,
  })
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @ApiPropertyOptional({
    description: 'Ticket priority',
    enum: TicketPriority,
    example: TicketPriority.MEDIUM,
    default: TicketPriority.MEDIUM,
  })
  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @ApiPropertyOptional({
    description: 'Ticket sentiment/mood',
    example: 'neutral',
  })
  @IsString()
  @IsOptional()
  sentiment?: string;

  @ApiPropertyOptional({
    description: 'ID of the user assigned to this ticket',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({
    description:
      'ID of the group assigned to this ticket (all group members will see it)',
    example: '507f1f77bcf86cd799439015',
  })
  @IsMongoId()
  @IsOptional()
  assignedToGroupId?: string;

  @ApiPropertyOptional({
    description: 'ID of the category this ticket belongs to',
    example: '507f1f77bcf86cd799439012',
  })
  @IsMongoId()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Array of tag IDs',
    example: ['507f1f77bcf86cd799439013', '507f1f77bcf86cd799439014'],
    type: [String],
  })
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  tagIds?: string[];

  @ApiPropertyOptional({
    description: 'Latest message content for preview',
  })
  @IsString()
  @IsOptional()
  latestMessageContent?: string;

  @ApiPropertyOptional({
    description: 'Latest message author type for preview',
  })
  @IsString()
  @IsOptional()
  latestMessageAuthorType?: string;
}
