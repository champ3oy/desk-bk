import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIUsageLog, AIUsageLogDocument } from './entities/ai-usage-log.entity';
import { getTelemetryContext } from './telemetry.context';

@Injectable()
export class AiUsageService implements OnModuleInit {
  private readonly logger = new Logger(AiUsageService.name);

  // Static reference for AIModelFactory to use
  private static instance: AiUsageService | null = null;

  constructor(
    @InjectModel(AIUsageLog.name)
    private readonly usageLogModel: Model<AIUsageLogDocument>,
  ) {}

  onModuleInit() {
    // Set the static instance when the module initializes
    AiUsageService.instance = this;
    this.logger.log('AI Usage Service initialized and plugged into Factory');
  }

  /**
   * Static helper for the AIModelFactory to log usage
   */
  static async logUsage(data: {
    feature?: string;
    provider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    performanceMs: number;
    metadata?: Record<string, any>;
  }) {
    if (!this.instance) return;

    const context = getTelemetryContext();

    try {
      await this.instance.usageLogModel.create({
        organizationId: context.organizationId,
        userId: context.userId,
        ticketId: context.ticketId,
        feature: data.feature || context.feature || 'unknown',
        provider: data.provider,
        modelName: data.modelName,
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        totalTokens: (data.inputTokens || 0) + (data.outputTokens || 0),
        performanceMs: data.performanceMs,
        metadata: data.metadata,
      });
    } catch (error) {
      // Fail silently for telemetry - don't break the main AI feature
      console.error('[Telemetry] Failed to log AI usage:', error);
    }
  }

  /**
   * Get total usage for an organization (useful for dashboard later)
   */
  /**
   * Get detailed usage report with filters
   */
  async getUsageReport(filters: {
    organizationId?: string;
    feature?: string;
    modelName?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const query: any = {};

    if (filters.organizationId) query.organizationId = filters.organizationId;
    if (filters.feature) query.feature = filters.feature;
    if (filters.modelName) query.modelName = filters.modelName;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    const [summary, breakdownByModel, breakdownByFeature] = await Promise.all([
      // ... previous aggregates ...
      // 1. Overall Summary
      this.usageLogModel.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            totalInputTokens: { $sum: '$inputTokens' },
            totalOutputTokens: { $sum: '$outputTokens' },
            totalTokens: { $sum: '$totalTokens' },
            avgPerformanceMs: { $avg: '$performanceMs' },
          },
        },
      ]),
      // 2. Breakdown by Model
      this.usageLogModel.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$modelName',
            requests: { $sum: 1 },
            totalInputTokens: { $sum: '$inputTokens' },
            totalOutputTokens: { $sum: '$outputTokens' },
            tokens: { $sum: '$totalTokens' },
            avgPerformance: { $avg: '$performanceMs' },
          },
        },
        { $sort: { tokens: -1 } },
      ]),
      // 3. Breakdown by Feature (Function)
      this.usageLogModel.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$feature',
            requests: { $sum: 1 },
            totalInputTokens: { $sum: '$inputTokens' },
            totalOutputTokens: { $sum: '$outputTokens' },
            tokens: { $sum: '$totalTokens' },
            avgPerformance: { $avg: '$performanceMs' },
          },
        },
        { $sort: { tokens: -1 } },
      ]),
    ]);

    const formattedSummary = summary[0] || {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      avgPerformanceMs: 0,
    };

    // Enrich with costs
    const enrichedByModel = breakdownByModel.map((item) => ({
      ...item,
      estimatedCost: AiUsageService.calculateEstimatedCost(
        item._id,
        item.totalInputTokens,
        item.totalOutputTokens,
      ),
    }));

    // In the summary, we sum the estimated cost of all models
    const totalEstimatedCost = enrichedByModel.reduce(
      (sum, item) => sum + item.estimatedCost,
      0,
    );

    return {
      filters: {
        ...filters,
        activeFiltersCount: Object.values(filters).filter(Boolean).length,
      },
      summary: {
        ...formattedSummary,
        totalEstimatedCost,
      },
      breakdown: {
        byModel: enrichedByModel,
        byFeature: breakdownByFeature.map((f) => ({
          ...f,
          // Feature cost is tricky because one feature uses many models,
          // but for now, we'll provide the raw tokens.
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get usage aggregated by day for line charts
   */
  async getTimeSeriesUsage(days: number = 30, organizationId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const query: any = { createdAt: { $gte: since } };
    if (organizationId) query.organizationId = organizationId;

    const results = await this.usageLogModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            model: '$modelName',
          },
          input: { $sum: '$inputTokens' },
          output: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          requests: { $sum: 1 },
          avgLatency: { $avg: '$performanceMs' },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]);

    // Format the results to include model and calculated cost
    return results
      .map((item) => {
        const date = item._id.date;
        const model = item._id.model;
        const cost = AiUsageService.calculateEstimatedCost(
          model,
          item.input,
          item.output,
        );

        return {
          date,
          model,
          tokens: item.totalTokens,
          inputTokens: item.input,
          outputTokens: item.output,
          requests: item.requests,
          estimatedCost: Number(cost.toFixed(6)),
          avgLatency: Math.round(item.avgLatency),
        };
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.model.localeCompare(b.model),
      );
  }

  /**
   * Get top organizations by AI spend/usage
   */
  async getTopOrganizations(limit: number = 10) {
    const rawResults = await this.usageLogModel.aggregate([
      {
        $group: {
          _id: '$organizationId',
          totalTokens: { $sum: '$totalTokens' },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          requestCount: { $sum: 1 },
          avgLatency: { $avg: '$performanceMs' },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'organizations',
          localField: '_id',
          foreignField: '_id',
          as: 'orgDetails',
        },
      },
      {
        $project: {
          organizationId: '$_id',
          name: { $arrayElemAt: ['$orgDetails.name', 0] },
          totalTokens: 1,
          totalInputTokens: 1,
          totalOutputTokens: 1,
          requestCount: 1,
          avgLatency: { $round: ['$avgLatency', 0] },
          _id: 0,
        },
      },
    ]);

    // Add generic cost estimation (assuming Gemini Pro as average)
    return rawResults.map((org) => ({
      ...org,
      estimatedCost: AiUsageService.calculateEstimatedCost(
        'gemini-3-pro-preview',
        org.totalInputTokens,
        org.totalOutputTokens,
      ),
    }));
  }

  /**
   * Get top human users (agents) by AI usage
   */
  async getTopUsers(limit: number = 10) {
    return this.usageLogModel.aggregate([
      { $match: { userId: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$userId',
          totalTokens: { $sum: '$totalTokens' },
          requestCount: { $sum: 1 },
          features: { $addToSet: '$feature' },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $project: {
          userId: '$_id',
          name: { $arrayElemAt: ['$userDetails.firstName', 0] },
          email: { $arrayElemAt: ['$userDetails.email', 0] },
          totalTokens: 1,
          requestCount: 1,
          features: 1,
          _id: 0,
        },
      },
    ]);
  }

  /**
   * Get recently failed AI requests for debugging
   */
  async getRecentErrors(limit: number = 20) {
    return this.usageLogModel
      .find({ 'metadata.error': { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(
        'organizationId feature modelName metadata performanceMs createdAt',
      )
      .exec();
  }

  /**
   * Get efficiency stats for each model (Cost vs Latency)
   */
  async getModelEfficiency() {
    return this.usageLogModel.aggregate([
      {
        $group: {
          _id: '$modelName',
          avgLatency: { $avg: '$performanceMs' },
          totalRequests: { $sum: 1 },
          errorCount: {
            $sum: { $cond: [{ $ifNull: ['$metadata.error', false] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          model: '$_id',
          avgLatency: { $round: ['$avgLatency', 0] },
          totalRequests: 1,
          errorRate: {
            $multiply: [{ $divide: ['$errorCount', '$totalRequests'] }, 100],
          },
          _id: 0,
        },
      },
      { $sort: { avgLatency: 1 } },
    ]);
  }

  /**
   * Static helper to estimate cost in USD based on current market rates
   * (Prices per 1M tokens as of Feb 2026)
   */
  static calculateEstimatedCost(
    model: string,
    input: number,
    output: number,
  ): number {
    const m = model.toLowerCase();
    let inputPrice = 0; // Price per 1M tokens
    let outputPrice = 0;

    if (m.includes('pro')) {
      inputPrice = 1.25;
      outputPrice = 3.75;
    } else if (m.includes('flash')) {
      inputPrice = 0.1;
      outputPrice = 0.3;
    } else if (m.includes('gpt-4o-mini')) {
      inputPrice = 0.15;
      outputPrice = 0.6;
    } else if (m.includes('gpt-4o')) {
      inputPrice = 2.5;
      outputPrice = 10.0;
    } else {
      inputPrice = 0.5; // Generic fallback
      outputPrice = 1.5;
    }

    return (
      (input / 1_000_000) * inputPrice + (output / 1_000_000) * outputPrice
    );
  }

  /**
   * Get total usage for an organization (useful for dashboard later)
   */
}
