import { IsString, IsNotEmpty, IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetWidgetHistoryDto {
  @ApiProperty({
    description: 'Organization ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  channelId: string;

  @ApiProperty({
    description: 'Widget session ID',
    example: 'session-123-abc',
  })
  @IsString()
  @IsNotEmpty()
  sessionId: string;
}
