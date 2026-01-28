import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ElevenLabsService } from './elevenlabs.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('ElevenLabs')
@ApiBearerAuth('JWT-auth')
@Controller('elevenlabs')
@UseGuards(JwtAuthGuard)
export class ElevenLabsController {
  constructor(private readonly elevenLabsService: ElevenLabsService) {}

  @Get('signed-url')
  @ApiOperation({
    summary: 'Get a signed URL for an authenticated conversation',
  })
  async getSignedUrl() {
    return this.elevenLabsService.getSignedUrl();
  }

  @Get('config-status')
  @ApiOperation({ summary: 'Check if ElevenLabs integration is configured' })
  async getConfigStatus() {
    return this.elevenLabsService.getConfigStatus();
  }
}
