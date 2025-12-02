import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DraftResponseDto {
  @ApiProperty({
    description: 'Ticket ID to draft a response for',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  ticketId: string;

  @ApiPropertyOptional({
    description: 'Additional context to consider when drafting the response',
    example: 'Customer is a VIP member',
  })
  @IsString()
  @IsOptional()
  context?: string;
}

export class DraftResponseResponseDto {
  @ApiProperty({
    description: 'AI-generated response draft',
    example: 'Thank you for contacting us. I understand your concern...',
  })
  content: string;

  @ApiProperty({
    description: 'Additional metadata from the AI agent',
    example: {},
  })
  metadata?: any;
}

