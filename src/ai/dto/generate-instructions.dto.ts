import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Max, Min } from 'class-validator';

export class GenerateInstructionsDto {
  @ApiProperty({
    description: 'Description of the desired AI personality',
    example: 'Friendly, helpful customer support agent who loves emojis',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Formality level from 0 to 100',
    example: 60,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  formality: number;

  @ApiProperty({
    description: 'Empathy level from 0 to 100',
    example: 80,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  empathy: number;

  @ApiProperty({
    description: 'Verbosity level from 0 to 100',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  verbosity: number;
}

export class GenerateInstructionsResponseDto {
  @ApiProperty({
    description: 'Generated system instructions',
    example: '# ROLE\nYou are a helpful assistant...',
  })
  @IsString()
  content: string;
}
