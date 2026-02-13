import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnalyticsService } from './analytics.service';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/entities/organization.entity';

@Injectable()
export class AnalyticsCronService {
  private readonly logger = new Logger(AnalyticsCronService.name);

  constructor(
    @InjectModel(Organization.name)
    private orgModel: Model<OrganizationDocument>,
    private analyticsService: AnalyticsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAggregation() {
    this.logger.log(
      '[AnalyticsCronService] Starting hourly analytics aggregation for all organizations...',
    );

    const orgs = await this.orgModel.find({}).exec();

    if (orgs.length === 0) {
      this.logger.debug('[AnalyticsCronService] No organizations found.');
      return;
    }

    const tasks = orgs.map(async (org) => {
      try {
        this.logger.log(
          `[AnalyticsCronService] Aggregating analytics for org: ${org.name} (${org._id})`,
        );
        await this.analyticsService.refreshAllStats(org._id.toString());
      } catch (err) {
        this.logger.error(
          `[AnalyticsCronService] Failed to aggregate analytics for org ${org._id}: ${err.message}`,
        );
      }
    });

    await Promise.all(tasks);
    this.logger.log(
      '[AnalyticsCronService] Analytics aggregation completed for all organizations.',
    );
  }
}
