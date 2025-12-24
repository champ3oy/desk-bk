import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class ChatHistoryItem {
  @ApiProperty({
    description: 'Role of the message sender',
    example: 'user',
    enum: ['user', 'assistant'],
  })
  @IsString()
  role: 'user' | 'assistant';

  @ApiProperty({
    description: 'Content of the message',
    example: 'Hello, how can I help you?',
  })
  @IsString()
  content: string;
}

export class PlaygroundChatDto {
  @ApiProperty({
    description: 'The user message to the AI',
    example: 'How do I reset my password?',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    description: 'Previous conversation history for context',
    example: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi! How can I help you?' },
    ],
    required: false,
    type: [ChatHistoryItem],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryItem)
  history?: ChatHistoryItem[];

  @ApiProperty({
    description: 'The AI provider to use',
    example: 'google',
    required: false,
  })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({
    description: 'The specific model of the provider',
    example: 'gemini-1.5-flash',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'The email of the customer (if known)',
    example: 'customer@example.com',
    required: false,
  })
  @IsString()
  @IsOptional()
  customerEmail?: string;
}

export class PlaygroundChatResponseDto {
  @ApiProperty({
    description: 'The AI generated response',
    example: 'You can reset your password by clicking...',
  })
  content: string;
}
