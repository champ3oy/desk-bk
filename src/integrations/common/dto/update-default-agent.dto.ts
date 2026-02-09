import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDefaultAgentDto {
  @ApiPropertyOptional({
    description: 'ID of the agent to set as default, or null to remove',
    example: '507f1f77bcf86cd799439011',
  })
  @ValidateIf((o) => o.defaultAgentId !== null)
  @IsMongoId()
  @IsOptional()
  defaultAgentId?: string | null;
}
