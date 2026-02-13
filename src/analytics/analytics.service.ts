import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  Ticket,
  TicketDocument,
  TicketStatus,
} from '../tickets/entities/ticket.entity';
import {
  Customer,
  CustomerDocument,
} from '../customers/entities/customer.entity';
import { User, UserDocument } from '../users/entities/user.entity';
import { AIModelFactory } from '../ai/ai-model.factory';
import { HumanMessage } from '@langchain/core/messages';
import {
  OrgAnalytics,
  OrgAnalyticsDocument,
} from './entities/org-analytics.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(OrgAnalytics.name)
    private analyticsModel: Model<OrgAnalyticsDocument>,
    private configService: ConfigService,
  ) {}

  async getSummaryStats(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);

    const [
      totalTickets,
      openTickets,
      resolvedTickets,
      totalCustomers,
      totalAgents,
    ] = await Promise.all([
      this.ticketModel.countDocuments({ organizationId: orgId }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: TicketStatus.OPEN,
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      }),
      this.customerModel.countDocuments({ organizationId: orgId }),
      this.userModel.countDocuments({ organizationId: orgId }),
    ]);

    // Calculate AI Resolution Rate
    const aiResolved = await this.ticketModel.countDocuments({
      organizationId: orgId,
      status: { $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      resolutionType: 'ai',
    });

    const aiResolutionRate =
      resolvedTickets > 0 ? (aiResolved / resolvedTickets) * 100 : 0;

    // Calculate Avg Response Time (in hours)
    const responseTimeResult = await this.ticketModel.aggregate([
      {
        $match: {
          organizationId: orgId,
          firstResponseAt: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          diff: { $subtract: ['$firstResponseAt', '$createdAt'] },
        },
      },
      {
        $group: {
          _id: null,
          avgResponseTimeMs: { $avg: '$diff' },
        },
      },
    ]);

    const avgResponseTimeHours =
      responseTimeResult.length > 0
        ? responseTimeResult[0].avgResponseTimeMs / (1000 * 60 * 60)
        : 0;

    // Calculate AI Sentiment Score
    const sentimentScoreMap = {
      happy: 10,
      grateful: 10,
      neutral: 7,
      confused: 5,
      concerned: 4,
      sad: 3,
      frustrated: 2,
      angry: 1,
    };

    const ticketsWithSentiment = await this.ticketModel.find(
      {
        organizationId: orgId,
        sentiment: { $exists: true, $ne: null },
      },
      { sentiment: 1 },
    );

    let totalSentimentScore = 0;
    let sentimentCount = 0;

    ticketsWithSentiment.forEach((t) => {
      const score =
        sentimentScoreMap[t.sentiment as keyof typeof sentimentScoreMap];
      if (score !== undefined) {
        totalSentimentScore += score;
        sentimentCount++;
      }
    });

    const avgSentimentScore =
      sentimentCount > 0 ? totalSentimentScore / sentimentCount : 0;

    return {
      openTickets,
      totalTickets,
      resolvedTickets,
      totalCustomers,
      totalAgents,
      aiResolutionRate: Math.round(aiResolutionRate),
      avgResponseTimeHours: Number(avgResponseTimeHours.toFixed(1)),
      avgSentimentScore: Number(avgSentimentScore.toFixed(1)),
    };
  }

  async getTrendingTopics(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);

    // Fetch recent ticket subjects for AI analysis
    const recentTickets = await this.ticketModel
      .find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('subject createdAt')
      .exec();

    if (recentTickets.length < 3) {
      return [];
    }

    try {
      const model = AIModelFactory.create(this.configService);
      const subjects = recentTickets.map((t) => t.subject).join('\n');

      const prompt = `Analyze these customer support ticket subjects and identify the top 3-5 trending topics/issues.
For each topic, provide:
1. Short 2-3 word name
2. Volume (how many of these 50 tickets belong to this topic)
3. Trend direction (UP, DOWN, or STABLE)
4. Trend percentage (random-ish but realistic based on volume)

Return ONLY a JSON array of objects with keys: "name", "volume", "trendDirection", "trendPercentage".

Subjects:
${subjects}`;

      const response = await model.invoke([new HumanMessage(prompt)]);
      const content =
        typeof response.content === 'string' ? response.content : '';

      // Extract JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonString);

      return parsed.map((item: any, index: number) => ({
        topicId: (index + 1).toString(),
        name: item.name,
        volume: item.volume,
        trendPercentage: item.trendPercentage || 0,
        trendDirection: item.trendDirection || 'STABLE',
      }));
    } catch (error) {
      console.error('Failed to get trending topics via AI:', error);
      return [];
    }
  }

  async getSentimentHealth(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);
    const stats = await this.getSummaryStats(organizationId);

    // Aggregate by sentiment for breakdown
    const sentimentCounts = await this.ticketModel.aggregate([
      {
        $match: {
          organizationId: orgId,
          sentiment: { $exists: true, $ne: null },
        },
      },
      { $group: { _id: '$sentiment', count: { $sum: 1 } } },
    ]);

    const totalWithSentiment = sentimentCounts.reduce(
      (acc, s) => acc + s.count,
      0,
    );

    const sentimentScoreMap = {
      happy: 100,
      grateful: 100,
      neutral: 70,
      confused: 50,
      concerned: 40,
      sad: 30,
      frustrated: 20,
      angry: 10,
    };

    const topicBreakdown = sentimentCounts.map((s) => ({
      topicName: s._id.charAt(0).toUpperCase() + s._id.slice(1),
      averageScore:
        sentimentScoreMap[s._id as keyof typeof sentimentScoreMap] || 50,
    }));

    // Find primary pain point via AI from negative tickets
    let primaryPainPoint = 'General feedback';
    let negativeSpikeDetected = false;

    const negativeTickets = await this.ticketModel
      .find({
        organizationId: orgId,
        sentiment: { $in: ['angry', 'frustrated', 'sad', 'confused'] },
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('subject description')
      .exec();

    if (negativeTickets.length > 0) {
      try {
        const model = AIModelFactory.create(this.configService);
        const subjects = negativeTickets
          .map((t) => `- ${t.subject}: ${t.description.substring(0, 100)}`)
          .join('\n');

        const prompt = `Analyze these negative customer support tickets and identify the SINGLE most common specific "pain point" or root cause.
Be concise (3-5 words).
Subjects and descriptions:
${subjects}

Return ONLY the phrase.`;

        const response = await model.invoke([new HumanMessage(prompt)]);
        primaryPainPoint =
          typeof response.content === 'string'
            ? response.content.trim().replace(/^"|"$/g, '')
            : 'General feedback';
        negativeSpikeDetected = negativeTickets.length >= 3;
      } catch (error) {
        console.error('Failed to analyze pain point via AI:', error);
      }
    }

    return {
      globalScore: Math.round(stats.avgSentimentScore * 10),
      sentimentTrend: 4,
      moodLabel:
        stats.avgSentimentScore > 8
          ? 'Great'
          : stats.avgSentimentScore > 6
            ? 'Positive'
            : stats.avgSentimentScore > 4
              ? 'Neutral'
              : 'Critical',
      negativeSpikeDetected,
      primaryPainPoint,
      topicBreakdown,
    };
  }

  async getAutopilotROI(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);

    const [aiResolved, humanResolved, totalResolved] = await Promise.all([
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        resolutionType: 'ai',
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        resolutionType: 'human',
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      }),
    ]);

    // Get average response times
    const aiTimeResult = await this.ticketModel.aggregate([
      {
        $match: {
          organizationId: orgId,
          resolutionType: 'ai',
          firstResponseAt: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avg: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } },
        },
      },
    ]);

    const humanTimeResult = await this.ticketModel.aggregate([
      {
        $match: {
          organizationId: orgId,
          resolutionType: 'human',
          firstResponseAt: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avg: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } },
        },
      },
    ]);

    const aiAvgSeconds =
      aiTimeResult.length > 0 ? aiTimeResult[0].avg / 1000 : 4.5;
    const humanAvgSeconds =
      humanTimeResult.length > 0 ? humanTimeResult[0].avg / 1000 : 480;

    const speedFactor = humanAvgSeconds / aiAvgSeconds;

    // Use AI to determine trend, percentage and a performance verdict based on volume
    let trend: 'IMPROVING' | 'DECLINING' | 'STABLE' = 'STABLE';
    let trendPercentage = 0;
    let performanceVerdict = 'AI is currently assisting with support baseline.';

    try {
      const model = AIModelFactory.create(this.configService);
      const prompt = `Based on these Autopilot performance stats, determine the trend direction (IMPROVING, DECLINING, or STABLE), a realistic trend percentage, and a short 1-sentence "performance verdict" explaining if AI is doing better than humans and why.

Stats:
- AI Resolutions: ${aiResolved}
- Human Resolutions: ${humanResolved}
- AI Avg Speed: ${aiAvgSeconds.toFixed(2)}s
- Human Avg Speed: ${humanAvgSeconds.toFixed(2)}s
- Touchless Rate: ${totalResolved > 0 ? Math.round((aiResolved / totalResolved) * 100) : 0}%

Compare AI speed vs human speed and AI volume vs human volume. 
If AI resolves more or is > 5x faster, it's generally "doing better" in efficiency.

Return ONLY a JSON object: {
  "trend": "IMPROVING" | "DECLINING" | "STABLE", 
  "percentage": number,
  "verdict": string
}`;

      const response = await model.invoke([new HumanMessage(prompt)]);
      const jsonStr = (
        typeof response.content === 'string' ? response.content : ''
      ).match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        trend = parsed.trend;
        trendPercentage = parsed.percentage;
        performanceVerdict = parsed.verdict;
      }
    } catch (e) {
      console.error('Failed to get AI trend for ROI:', e);
    }

    return {
      speedImprovementFactor: Number(speedFactor.toFixed(1)),
      autoResolutionCount: aiResolved,
      humanResolutionCount: humanResolved,
      resolutionRatio:
        humanResolved > 0
          ? Number((aiResolved / humanResolved).toFixed(2))
          : aiResolved > 0
            ? aiResolved
            : 0,
      aiAvgResponseTime: aiAvgSeconds,
      humanAvgResponseTime: humanAvgSeconds,
      touchlessResolutionRate:
        totalResolved > 0 ? Math.round((aiResolved / totalResolved) * 100) : 0,
      totalHoursSaved: Number(
        ((aiResolved * humanAvgSeconds) / 3600).toFixed(1),
      ),
      trend,
      trendPercentage,
      performanceVerdict,
    };
  }

  async getLiveActivity(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);

    // Get last few tickets
    const recentTickets = await this.ticketModel
      .find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .limit(6)
      .exec();

    return recentTickets.map((t) => {
      let type:
        | 'ticket-created'
        | 'ai-resolved'
        | 'ai-indexed'
        | 'user-registered' = 'ticket-created';
      if (t.status === TicketStatus.RESOLVED && t.resolutionType === 'ai') {
        type = 'ai-resolved';
      }

      return {
        id: t._id,
        type,
        description:
          type === 'ai-resolved'
            ? `AI resolved Ticket #${t.displayId || t._id.toString().substring(19)}`
            : `Ticket created: ${t.subject.substring(0, 40)}`,
        time: t.createdAt,
      };
    });
  }

  async refreshAllStats(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);

    const [summary, trendingTopics, sentimentHealth, autopilotROI] =
      await Promise.all([
        this.getSummaryStats(organizationId),
        this.getTrendingTopics(organizationId),
        this.getSentimentHealth(organizationId),
        this.getAutopilotROI(organizationId),
      ]);

    await this.analyticsModel.findOneAndUpdate(
      { organizationId: orgId },
      {
        summary,
        trendingTopics,
        sentimentHealth,
        autopilotROI,
        lastUpdatedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    return { success: true };
  }

  async getStoredAnalytics(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);
    return this.analyticsModel.findOne({ organizationId: orgId });
  }
}
