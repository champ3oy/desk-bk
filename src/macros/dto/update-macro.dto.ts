import { PartialType } from '@nestjs/swagger';
import { CreateMacroDto } from './create-macro.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMacroDto extends PartialType(CreateMacroDto) {
  @ApiPropertyOptional({
    description: 'Whether the macro is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
