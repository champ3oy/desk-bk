import { IsString, IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({
    description: 'Group name',
    example: 'Support Team A',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Group description',
    example: 'Primary support team for technical issues',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Array of user IDs to add as members',
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
    type: [String],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  memberIds?: string[];
}

