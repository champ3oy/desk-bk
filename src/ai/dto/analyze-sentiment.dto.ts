import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeSentimentDto {
  @ApiProperty({
    description: 'Ticket ID to analyze sentiment for',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  ticketId: string;
}

export class AnalyzeSentimentResponseDto {
  @ApiProperty({
    description: 'Primary sentiment detected',
    example: 'frustrated',
    enum: [
      'angry',
      'sad',
      'happy',
      'frustrated',
      'neutral',
      'concerned',
      'grateful',
      'confused',
    ],
  })
  sentiment: string;

  @ApiProperty({
    description: 'Confidence level of the sentiment analysis',
    example: 'high',
    enum: ['high', 'medium', 'low'],
  })
  confidence: string;

  @ApiProperty({
    description: 'Explanation of the sentiment analysis',
    example: 'Customer is expressing frustration with repeated issues...',
  })
  explanation: string;

  @ApiProperty({
    description: 'Key phrases that led to this sentiment',
    example: ['not working', 'frustrated', 'disappointed'],
    type: [String],
  })
  keyPhrases: string[];

  @ApiProperty({
    description: 'Full AI response content',
    example: 'The customer sentiment is frustrated...',
  })
  content: string;
}




