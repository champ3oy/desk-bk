import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  Post,
  Param,
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
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
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
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
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
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
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
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
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
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
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

  @Get('overview')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get overview analytics with KPIs and distributions',
  })
  getOverview(@Request() req) {
    return this.analyticsService.getOverview(req.user.organizationId);
  }

  @Get('pain-points')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get pain points, frustration rates, and AI vs human by category',
  })
  getPainPoints(@Request() req) {
    return this.analyticsService.getPainPoints(req.user.organizationId);
  }

  @Get('ai-performance')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get AI performance metrics, escalation reasons, and confidence',
  })
  getAIPerformance(@Request() req) {
    return this.analyticsService.getAIPerformance(req.user.organizationId);
  }

  @Get('agent-performance')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary:
      'Get agent performance. Without agentId returns all agents summary; with agentId returns detailed stats.',
  })
  getAgentPerformance(
    @Request() req,
    @Query('agentId') agentId?: string,
  ) {
    return this.analyticsService.getAgentPerformance(
      req.user.organizationId,
      agentId,
    );
  }
}
