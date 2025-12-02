import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SummarizeTicketDto {
  @ApiProperty({
    description: 'Ticket ID to summarize',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  ticketId: string;
}

export class SummarizeTicketResponseDto {
  @ApiProperty({
    description: 'AI-generated ticket summary',
    example: 'This ticket involves a customer unable to login to their account...',
  })
  summary: string;

  @ApiProperty({
    description: 'Full AI response content',
    example: 'Summary: This ticket involves...',
  })
  content: string;

  @ApiProperty({
    description: 'Additional metadata from the AI agent',
    example: {},
  })
  metadata?: any;
}

