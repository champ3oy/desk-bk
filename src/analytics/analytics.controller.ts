import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get summary dashboard statistics' })
  async getSummary(@Request() req, @Query('refresh') refresh?: string) {
    if (refresh === 'true') {
      return this.analyticsService.getSummaryStats(req.user.organizationId);
    }
    const stored = await this.analyticsService.getStoredAnalytics(
      req.user.organizationId,
    );
    return (
      stored?.summary ||
      this.analyticsService.getSummaryStats(req.user.organizationId)
    );
  }

  @Get('trending-topics')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get trending support topics' })
  async getTrendingTopics(@Request() req, @Query('refresh') refresh?: string) {
    if (refresh === 'true') {
      return this.analyticsService.getTrendingTopics(req.user.organizationId);
    }
    const stored = await this.analyticsService.getStoredAnalytics(
      req.user.organizationId,
    );
    return (
      stored?.trendingTopics ||
      this.analyticsService.getTrendingTopics(req.user.organizationId)
    );
  }

  @Get('sentiment-health')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get customer sentiment health metrics' })
  async getSentimentHealth(@Request() req, @Query('refresh') refresh?: string) {
    if (refresh === 'true') {
      return this.analyticsService.getSentimentHealth(req.user.organizationId);
    }
    const stored = await this.analyticsService.getStoredAnalytics(
      req.user.organizationId,
    );
    return (
      stored?.sentimentHealth ||
      this.analyticsService.getSentimentHealth(req.user.organizationId)
    );
  }

  @Get('autopilot-roi')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get AI resolution ROI metrics' })
  async getAutopilotROI(@Request() req, @Query('refresh') refresh?: string) {
    if (refresh === 'true') {
      return this.analyticsService.getAutopilotROI(req.user.organizationId);
    }
    const stored = await this.analyticsService.getStoredAnalytics(
      req.user.organizationId,
    );
    return (
      stored?.autopilotROI ||
      this.analyticsService.getAutopilotROI(req.user.organizationId)
    );
  }

  @Get('live-activity')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get recent support activity' })
  getLiveActivity(@Request() req) {
    return this.analyticsService.getLiveActivity(req.user.organizationId);
  }

  @Post('refresh')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Manually trigger analytics aggregation' })
  refreshAnalytics(@Request() req) {
    return this.analyticsService.refreshAllStats(req.user.organizationId);
  }
}
