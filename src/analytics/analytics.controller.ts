import { Controller, Get, UseGuards, Request } from '@nestjs/common';
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
  getSummary(@Request() req) {
    return this.analyticsService.getSummaryStats(req.user.organizationId);
  }

  @Get('trending-topics')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get trending support topics' })
  getTrendingTopics(@Request() req) {
    return this.analyticsService.getTrendingTopics(req.user.organizationId);
  }

  @Get('sentiment-health')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get customer sentiment health metrics' })
  getSentimentHealth(@Request() req) {
    return this.analyticsService.getSentimentHealth(req.user.organizationId);
  }

  @Get('autopilot-roi')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get AI resolution ROI metrics' })
  getAutopilotROI(@Request() req) {
    return this.analyticsService.getAutopilotROI(req.user.organizationId);
  }

  @Get('live-activity')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get recent support activity' })
  getLiveActivity(@Request() req) {
    return this.analyticsService.getLiveActivity(req.user.organizationId);
  }
}
