import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MergeCustomerDto {
  @ApiProperty({
    description:
      'The ID of the customer to be merged into the current customer',
    example: '60d5ecb8b5c9c64cc0e9e555',
  })
  @IsNotEmpty()
  @IsString()
  targetCustomerId: string;
}
