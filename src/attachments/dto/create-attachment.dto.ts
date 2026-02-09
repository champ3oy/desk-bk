import { IsString, IsMongoId, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAttachmentDto {
  @ApiProperty({
    description: 'Filename of the attachment',
    example: 'document.pdf',
  })
  @IsString()
  filename: string;

  @ApiProperty({
    description: 'Original name of the file',
    example: 'my-document.pdf',
  })
  @IsString()
  originalName: string;

  @ApiProperty({
    description: 'MIME type of the file',
    example: 'application/pdf',
  })
  @IsString()
  mimeType: string;

  @ApiProperty({
    description: 'Size of the file',
    example: '1024',
  })
  @IsString()
  size: string;

  @ApiProperty({
    description: 'Path where the file is stored',
    example: '/uploads/document.pdf',
  })
  @IsString()
  path: string;

  @ApiPropertyOptional({
    description: 'ID of the ticket this attachment belongs to',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsOptional()
  ticketId?: string;

  @ApiPropertyOptional({
    description: 'ID of the comment this attachment belongs to',
    example: '507f1f77bcf86cd799439012',
  })
  @IsMongoId()
  @IsOptional()
  commentId?: string;
}
