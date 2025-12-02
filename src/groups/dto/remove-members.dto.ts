import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveMembersDto {
  @ApiProperty({
    description: 'Array of user IDs to remove from the group',
    example: ['507f1f77bcf86cd799439011'],
    type: [String],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  memberIds: string[];
}

