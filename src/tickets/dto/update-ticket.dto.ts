import {
  IsString,
  IsEnum,
  IsOptional,
  IsMongoId,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  TicketStatus,
  TicketPriority,
  TicketChannel,
} from '../entities/ticket.entity';

export class UpdateTicketDto {
  @ApiPropertyOptional({
    description: 'Ticket subject',
    example: 'Unable to login to account',
  })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({
    description: 'Ticket description',
    example:
      'I am unable to login to my account. I keep getting an error message.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Ticket status',
    enum: TicketStatus,
    example: TicketStatus.IN_PROGRESS,
  })
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @ApiPropertyOptional({
    description: 'Ticket priority',
    enum: TicketPriority,
    example: TicketPriority.HIGH,
  })
  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @ApiPropertyOptional({
    description: 'Ticket channel',
    enum: TicketChannel,
    example: TicketChannel.WHATSAPP,
  })
  @IsEnum(TicketChannel)
  @IsOptional()
  channel?: TicketChannel;

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
    description: 'Array of user IDs following this ticket',
    example: ['507f1f77bcf86cd799439011'],
    type: [String],
  })
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  followers?: string[];

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is disabled for this ticket',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  aiAutoReplyDisabled?: boolean;

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
