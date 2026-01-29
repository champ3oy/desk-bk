import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType, MessageChannel } from '../entities/message.entity';

export class CreateMessageDto {
  @ApiProperty({
    description: 'Message content',
    example: 'Hello, I can help you with this issue.',
  })
  @IsString()
  content: string;

  @ApiProperty({
    description:
      'Message type - external (visible to customer) or internal (not visible to customer)',
    enum: MessageType,
    example: MessageType.EXTERNAL,
  })
  @IsEnum(MessageType)
  messageType: MessageType;

  @ApiPropertyOptional({
    description: 'Communication channel used to send/receive this message',
    enum: MessageChannel,
    example: MessageChannel.PLATFORM,
    default: MessageChannel.PLATFORM,
  })
  @IsEnum(MessageChannel)
  @IsOptional()
  channel?: MessageChannel;

  @ApiPropertyOptional({
    description: 'Array of attachments',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        originalName: { type: 'string' },
        mimeType: { type: 'string' },
        size: { type: 'number' },
        path: { type: 'string' },
      },
    },
  })
  @IsOptional()
  attachments?: Array<{
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    path: string;
  }>;
}
