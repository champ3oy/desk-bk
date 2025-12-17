import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { GmailPollingService } from './gmail-polling.service';
import { OutlookPollingService } from './outlook-polling.service';
import { ManualSyncDto, GoogleCallbackDto, OutlookCallbackDto } from './dto/connect-email.dto';
import { EmailIntegrationService } from './email-integration.service';
import { EmailProvider } from './entities/email-integration.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';

@ApiTags('Integrations')
@Controller('integrations/email')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EmailIntegrationController {
  constructor(
    private readonly emailIntegrationService: EmailIntegrationService,
    private readonly gmailPollingService: GmailPollingService,
    private readonly outlookPollingService: OutlookPollingService,
  ) {}

  @Post('manual-sync')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Manually sync emails for a specific time range' })
  async manualSync(@Body() dto: ManualSyncDto, @Request() req) {
    const integration = await this.emailIntegrationService.findByEmail(dto.email);
    if (!integration) {
        throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    
    if (integration.organizationId.toString() !== req.user.organizationId) {
        throw new HttpException('Unauthorized access to this integration', HttpStatus.FORBIDDEN);
    }

    // Trigger async sync
    if (integration.provider === EmailProvider.OUTLOOK) {
        await this.outlookPollingService.syncMessagesManually(integration, dto.days);
    } else {
        await this.gmailPollingService.syncMessagesManually(integration, dto.days);
    }
    
    return { success: true, message: `Sync started for last ${dto.days} days` };
  }

  @Get('google/authorize-url')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get Google OAuth Authorization URL' })
  getGoogleAuthUrl(@Query('redirectUri') redirectUri: string) {
    if (!redirectUri) {
        throw new HttpException('redirectUri is required', HttpStatus.BAD_REQUEST);
    }
    const url = this.emailIntegrationService.getGoogleAuthUrl(redirectUri);
    return { url };
  }

  @Get('outlook/authorize-url')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get Outlook OAuth Authorization URL' })
  getOutlookAuthUrl(@Query('redirectUri') redirectUri: string) {
    if (!redirectUri) {
        throw new HttpException('redirectUri is required', HttpStatus.BAD_REQUEST);
    }
    const url = this.emailIntegrationService.getOutlookAuthUrl(redirectUri);
    return { url };
  }

  @Post('google/callback')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Handle Google OAuth Callback' })
  async handleGoogleCallback(
    @Body() dto: GoogleCallbackDto,
    @Request() req,
  ) {
    return this.emailIntegrationService.handleGoogleCallback(
      dto,
      req.user.organizationId,
    );
  }

  @Post('outlook/callback')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Handle Outlook OAuth Callback' })
  async handleOutlookCallback(
    @Body() dto: OutlookCallbackDto,
    @Request() req,
  ) {
    return this.emailIntegrationService.handleOutlookCallback(
      dto,
      req.user.organizationId,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'List connected email integrations' })
  async listIntegrations(@Request() req) {
    return this.emailIntegrationService.findByOrganization(
      req.user.organizationId,
    );
  }
}
