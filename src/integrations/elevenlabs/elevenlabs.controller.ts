import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ElevenLabsService } from './elevenlabs.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationsService } from '../../organizations/organizations.service';

@ApiTags('ElevenLabs')
@ApiBearerAuth('JWT-auth')
@Controller('elevenlabs')
@UseGuards(JwtAuthGuard)
export class ElevenLabsController {
  constructor(
    private readonly elevenLabsService: ElevenLabsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Get('signed-url')
  @ApiOperation({
    summary: 'Get a signed URL for an authenticated conversation',
  })
  async getSignedUrl(@Req() req) {
    const user = req.user;
    let agentId: string | undefined;

    if (user && user.organizationId) {
      try {
        const org = await this.organizationsService.findOne(
          user.organizationId,
        );
        if (org && org.elevenLabsAgentId) {
          agentId = org.elevenLabsAgentId;
        }
      } catch (e) {
        console.error('Failed to fetch organization for agent override', e);
      }
    }

    return this.elevenLabsService.getSignedUrl(agentId);
  }

  @Get('config-status')
  @ApiOperation({ summary: 'Check if ElevenLabs integration is configured' })
  async getConfigStatus(@Req() req) {
    const user = req.user;
    let agentId: string | undefined;

    if (user && user.organizationId) {
      try {
        const org = await this.organizationsService.findOne(
          user.organizationId,
        );
        if (org && org.elevenLabsAgentId) {
          agentId = org.elevenLabsAgentId;
        }
      } catch (e) {
        console.error('Failed to fetch organization for agent override', e);
      }
    }
    return this.elevenLabsService.getConfigStatus(agentId);
  }
}
