import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlaygroundChatDto {
  @ApiProperty({
    description: 'The user message to the AI',
    example: 'How do I reset my password?',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class PlaygroundChatResponseDto {
  @ApiProperty({
    description: 'The AI generated response',
    example: 'You can reset your password by clicking...',
  })
  content: string;
}
