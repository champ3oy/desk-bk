import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCommentDto {
  @ApiPropertyOptional({
    description: 'Comment content',
    example: 'Updated comment content',
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({
    description:
      'Whether this is an internal comment (only visible to agents/admins)',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;
}
