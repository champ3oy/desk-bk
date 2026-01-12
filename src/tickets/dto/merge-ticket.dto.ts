import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MergeTicketDto {
  @ApiProperty({
    description: 'The ID of the ticket to be merged (will be closed/deleted)',
    example: '60d5ecb8b5c9c64cc0e9e555',
  })
  @IsNotEmpty()
  @IsString()
  targetTicketId: string;
}
