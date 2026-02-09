import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateThreadDto {
  @ApiProperty({
    description: 'ID of the ticket this thread is associated with',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  ticketId: string;

  @ApiProperty({
    description: 'Customer ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  customerId: string;
}
