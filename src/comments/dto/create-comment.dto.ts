import { IsString, IsMongoId, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    description: 'Comment content',
    example: 'This is a comment on the ticket',
  })
  @IsString()
  content: string;

  @ApiProperty({
    description: 'ID of the ticket this comment belongs to',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  ticketId: string;

  @ApiPropertyOptional({
    description:
      'Whether this is an internal comment (only visible to agents/admins)',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;
}
