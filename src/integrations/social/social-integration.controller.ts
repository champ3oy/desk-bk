import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Patch,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SocialIntegrationService } from './social-integration.service';
import {
  ExchangeWhatsAppCodeDto,
  StoreWabaDataDto,
  ExchangeInstagramCodeDto,
} from './dto/social-integration.dto';
import { SocialProvider } from './entities/social-integration.entity';
import { UpdateDefaultAgentDto } from '../common/dto/update-default-agent.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';

@ApiTags('Integrations - Social')
@Controller('integrations/social')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SocialIntegrationController {
  constructor(
    private readonly socialIntegrationService: SocialIntegrationService,
  ) {}

  // ============================================
  // WhatsApp Endpoints
  // ============================================

  @Post('whatsapp/exchange-code')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Exchange WhatsApp authorization code for access token',
  })
  @ApiResponse({ status: 200, description: 'Code exchanged successfully' })
  async exchangeWhatsAppCode(
    @Body() dto: ExchangeWhatsAppCodeDto,
    @Request() req,
  ) {
    return this.socialIntegrationService.exchangeWhatsAppCode(
      dto,
      req.user.organizationId,
    );
  }

  @Post('whatsapp/store')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Store WhatsApp Business Account data after embedded signup',
  })
  @ApiResponse({ status: 201, description: 'WhatsApp integration created' })
  async storeWhatsAppData(
    @Body() body: StoreWabaDataDto & { accessToken: string },
    @Request() req,
  ) {
    const { accessToken, ...dto } = body;

    if (!accessToken) {
      throw new HttpException(
        'Access token is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.socialIntegrationService.storeWhatsAppData(
      dto,
      accessToken,
      req.user.organizationId,
    );
  }

  @Post('whatsapp/complete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Complete WhatsApp signup flow (exchange code and store data)',
  })
  @ApiResponse({ status: 201, description: 'WhatsApp integration completed' })
  async completeWhatsAppSignup(
    @Body() body: ExchangeWhatsAppCodeDto & Partial<StoreWabaDataDto>,
    @Request() req,
  ) {
    // First exchange the code
    const { accessToken } =
      await this.socialIntegrationService.exchangeWhatsAppCode(
        { code: body.code, redirectUri: body.redirectUri },
        req.user.organizationId,
      );

    // If WABA data was provided, store it
    if (body.wabaId) {
      return this.socialIntegrationService.storeWhatsAppData(
        {
          wabaId: body.wabaId,
          businessId: body.businessId,
          phoneNumberId: body.phoneNumberId,
          event: body.event,
          pin: body.pin,
        },
        accessToken,
        req.user.organizationId,
      );
    }

    // Return the token for client to use with embedded signup flow
    return {
      accessToken,
      message: 'Code exchanged. Complete embedded signup to store WABA data.',
    };
  }

  // ============================================
  // Instagram Endpoints
  // ============================================

  @Post('instagram/exchange-code')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Exchange Instagram authorization code for access token',
  })
  @ApiResponse({ status: 200, description: 'Code exchanged successfully' })
  async exchangeInstagramCode(
    @Body() dto: ExchangeInstagramCodeDto,
    @Request() req,
  ) {
    return this.socialIntegrationService.exchangeInstagramCode(
      dto,
      req.user.organizationId,
    );
  }

  @Post('instagram/complete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Complete Instagram OAuth flow (exchange code and fetch account)',
  })
  @ApiResponse({ status: 201, description: 'Instagram integration created' })
  async completeInstagramSignup(
    @Body() dto: ExchangeInstagramCodeDto,
    @Request() req,
  ) {
    return this.socialIntegrationService.completeInstagramSignup(
      dto,
      req.user.organizationId,
    );
  }

  // ============================================
  // Common Endpoints
  // ============================================

  @Get()
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'List all social integrations' })
  async listIntegrations(@Request() req) {
    return this.socialIntegrationService.findByOrganization(
      req.user.organizationId,
    );
  }

  @Get('whatsapp')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'List WhatsApp integrations' })
  async listWhatsAppIntegrations(@Request() req) {
    return this.socialIntegrationService.findByProvider(
      req.user.organizationId,
      SocialProvider.WHATSAPP,
    );
  }

  @Get('instagram')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'List Instagram integrations' })
  async listInstagramIntegrations(@Request() req) {
    return this.socialIntegrationService.findByProvider(
      req.user.organizationId,
      SocialProvider.INSTAGRAM,
    );
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle integration active status' })
  async toggleStatus(@Param('id') id: string, @Request() req) {
    return this.socialIntegrationService.toggleStatus(
      id,
      req.user.organizationId,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a social integration' })
  async deleteIntegration(@Param('id') id: string, @Request() req) {
    await this.socialIntegrationService.remove(id, req.user.organizationId);
    return { success: true, message: 'Integration deleted' };
  }

  @Patch(':id/default-agent')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update default agent for integration' })
  async setDefaultAgent(
    @Param('id') id: string,
    @Body() dto: UpdateDefaultAgentDto,
    @Request() req,
  ) {
    return this.socialIntegrationService.setDefaultAgent(
      id,
      req.user.organizationId,
      dto.defaultAgentId ?? null,
    );
  }
}
