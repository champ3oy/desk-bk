import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('AI Telemetry')
@ApiBearerAuth('JWT-auth')
@Controller('ai-telemetry')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiUsageController {
  constructor(private readonly aiUsageService: AiUsageService) {}

  @Get('usage')
  @Roles(UserRole.ADMIN) // Only admins can see cross-org usage or detailed metrics
  @ApiOperation({ summary: 'Get detailed AI usage and token metrics' })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({
    name: 'feature',
    required: false,
    description: 'Filter by function (e.g., draft-response)',
  })
  @ApiQuery({ name: 'modelName', required: false })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'ISO string date',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'ISO string date',
  })
  async getUsage(
    @Query('organizationId') organizationId?: string,
    @Query('feature') feature?: string,
    @Query('modelName') modelName?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this.aiUsageService.getUsageReport({
      organizationId,
      feature,
      modelName,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('time-series')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get daily aggregated AI usage for line charts' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiQuery({ name: 'organizationId', required: false })
  async getTimeSeries(
    @Query('days') days?: number,
    @Query('organizationId') organizationId?: string,
  ) {
    return await this.aiUsageService.getTimeSeriesUsage(
      days ? Number(days) : 30,
      organizationId,
    );
  }

  @Get('top-organizations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get top organizations by AI usage' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTopOrganizations(@Query('limit') limit?: number) {
    return await this.aiUsageService.getTopOrganizations(
      limit ? Number(limit) : 10,
    );
  }

  @Get('top-users')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get top human users by AI usage' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTopUsers(@Query('limit') limit?: number) {
    return await this.aiUsageService.getTopUsers(limit ? Number(limit) : 10);
  }

  @Get('errors')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get recently failed AI requests' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRecentErrors(@Query('limit') limit?: number) {
    return await this.aiUsageService.getRecentErrors(
      limit ? Number(limit) : 20,
    );
  }

  @Get('efficiency')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get model performance and efficiency metrics' })
  async getEfficiency() {
    return await this.aiUsageService.getModelEfficiency();
  }
}
