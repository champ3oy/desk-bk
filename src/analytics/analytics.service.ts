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
import {
  Category,
  CategoryDocument,
} from '../categories/entities/category.entity';
import { Thread, ThreadDocument } from '../threads/entities/thread.entity';
import { Message, MessageDocument } from '../threads/entities/message.entity';
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
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(Thread.name) private threadModel: Model<ThreadDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
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

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch tickets from the last 24 hours for AI analysis
    const recentTickets = await this.ticketModel
      .find({
        organizationId: orgId,
        createdAt: { $gte: twentyFourHoursAgo },
      })
      .sort({ createdAt: -1 })
      .limit(200) // Safety limit for AI prompt
      .select('subject createdAt')
      .exec();

    if (recentTickets.length < 3) {
      return [];
    }

    try {
      const model = AIModelFactory.create(this.configService);
      const subjects = recentTickets.map((t) => t.subject).join('\n');

      const prompt = `Analyze these customer support ticket subjects from the LAST 24 HOURS and identify the top 3-8 trending topics/issues.
For each topic, provide:
1. Short 2-3 word name
2. Volume (how many of the provided tickets belong to this topic)
3. Trend direction (UP, DOWN, or STABLE)
4. Trend percentage (realistic based on recent spikes)

Return ONLY a JSON array of objects with keys: "name", "volume", "trendDirection", "trendPercentage".

Subjects from last 24h:
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
        volume: item.volume || 0,
        trendPercentage: Number(item.trendPercentage) || 0,
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

    const topicBreakdown = sentimentCounts.map((s) => ({
      topicName: s._id.charAt(0).toUpperCase() + s._id.slice(1),
      averageScore:
        totalWithSentiment > 0
          ? Math.round((s.count / totalWithSentiment) * 100)
          : 0,
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

  // ──────────────────────────────────────────────
  // New endpoints matching frontend mock data shape
  // ──────────────────────────────────────────────

  private async getCategoryMap(
    organizationId: Types.ObjectId,
  ): Promise<Map<string, string>> {
    const categories = await this.categoryModel
      .find({ organizationId })
      .select('_id name')
      .lean();
    const map = new Map<string, string>();
    categories.forEach((c) => map.set(c._id.toString(), c.name));
    return map;
  }

  /**
   * GET /analytics/overview
   * Returns KPIs + distributions for the Overview tab
   */
  async getOverview(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);
    const resolvedStatuses = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

    const [
      totalTickets,
      uniqueCustomers,
      resolvedTickets,
      aiResolved,
      escalatedCount,
      categoryMap,
    ] = await Promise.all([
      this.ticketModel.countDocuments({ organizationId: orgId }),
      this.ticketModel.distinct('customerId', { organizationId: orgId }).then((ids) => ids.length),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: resolvedStatuses },
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: resolvedStatuses },
        resolutionType: 'ai',
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: TicketStatus.ESCALATED,
      }),
      this.getCategoryMap(orgId),
    ]);

    // Parallel aggregations
    const [
      medianTimes,
      frustratedCount,
      repeatCustomers,
      aiReplyStats,
      confidenceStats,
      weeklyData,
      categoryData,
      channelData,
      priorityData,
      statusData,
      sentimentData,
      avgMessagesPerTicket,
    ] = await Promise.all([
      // Median resolution times (AI vs Human)
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            status: { $in: resolvedStatuses },
            resolvedAt: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            resolutionType: 1,
            durationMs: { $subtract: ['$resolvedAt', '$createdAt'] },
          },
        },
        {
          $group: {
            _id: '$resolutionType',
            durations: { $push: '$durationMs' },
          },
        },
      ]),

      // Frustrated tickets
      this.ticketModel.countDocuments({
        organizationId: orgId,
        sentiment: 'frustrated',
      }),

      // Repeat customers (>1 ticket)
      this.ticketModel.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$customerId', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'total' },
      ]),

      // Avg AI replies
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            resolutionType: 'ai',
            aiReplyCount: { $exists: true, $gt: 0 },
          },
        },
        { $group: { _id: null, avg: { $avg: '$aiReplyCount' } } },
      ]),

      // High confidence %
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            aiConfidenceScore: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            highConfidence: {
              $sum: { $cond: [{ $eq: ['$aiConfidenceScore', 100] }, 1, 0] },
            },
          },
        },
      ]),

      // Weekly volume (last 8 weeks)
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            createdAt: {
              $gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: {
                  $dateFromParts: {
                    isoWeekYear: { $isoWeekYear: '$createdAt' },
                    isoWeek: { $isoWeek: '$createdAt' },
                    isoDayOfWeek: 1,
                  },
                },
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Categories
      this.ticketModel.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Channels
      this.ticketModel.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Priority
      this.ticketModel.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Status
      this.ticketModel.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Sentiment
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            sentiment: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: '$sentiment', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Avg messages per ticket (thread → message count → avg)
      this.threadModel.aggregate([
        { $match: { organizationId: orgId } },
        {
          $lookup: {
            from: 'messages',
            localField: '_id',
            foreignField: 'threadId',
            as: 'msgs',
            pipeline: [{ $count: 'c' }],
          },
        },
        {
          $project: {
            msgCount: {
              $ifNull: [{ $arrayElemAt: ['$msgs.c', 0] }, 0],
            },
          },
        },
        { $group: { _id: null, avg: { $avg: '$msgCount' } } },
      ]),
    ]);

    // Compute medians from sorted arrays
    const computeMedian = (arr: number[]): number => {
      if (arr.length === 0) return 0;
      const sorted = arr.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianMs =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      return Number((medianMs / (1000 * 60 * 60)).toFixed(1));
    };

    const allDurations: number[] = [];
    let aiMedianHrs = 0;
    let humanMedianHrs = 0;

    for (const group of medianTimes) {
      const durations = group.durations as number[];
      allDurations.push(...durations);
      if (group._id === 'ai') aiMedianHrs = computeMedian(durations);
      else if (group._id === 'human') humanMedianHrs = computeMedian(durations);
    }

    const medianResolutionHrs = computeMedian(allDurations);
    const repeatCount =
      repeatCustomers.length > 0 ? repeatCustomers[0].total : 0;
    const aiResolutionRate =
      resolvedTickets > 0
        ? Number(((aiResolved / resolvedTickets) * 100).toFixed(1))
        : 0;
    const escalationRate =
      totalTickets > 0
        ? Number(((escalatedCount / totalTickets) * 100).toFixed(1))
        : 0;
    const frustratedPct =
      totalTickets > 0
        ? Number(((frustratedCount / totalTickets) * 100).toFixed(1))
        : 0;
    const avgAiReplies =
      aiReplyStats.length > 0
        ? Number(aiReplyStats[0].avg.toFixed(1))
        : 0;
    const highConfidencePct =
      confidenceStats.length > 0
        ? Number(
            (
              (confidenceStats[0].highConfidence / confidenceStats[0].total) *
              100
            ).toFixed(1),
          )
        : 0;

    // Format weekly with readable labels
    const formatWeekLabel = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    };

    const channelLabelMap: Record<string, string> = {
      email: 'Email',
      whatsapp: 'WhatsApp',
      widget: 'Widget',
      sms: 'SMS',
      voice: 'Voice',
      api: 'API',
    };

    return {
      kpis: {
        total_tickets: totalTickets,
        unique_customers: uniqueCustomers,
        ai_resolution_rate: aiResolutionRate,
        median_resolution_hrs: medianResolutionHrs,
        ai_median_hrs: aiMedianHrs,
        human_median_hrs: humanMedianHrs,
        escalation_rate: escalationRate,
        avg_ai_replies: avgAiReplies,
        high_confidence_pct: highConfidencePct,
        frustrated_pct: frustratedPct,
        repeat_customers: repeatCount,
        repeat_pct:
          uniqueCustomers > 0
            ? Number(((repeatCount / uniqueCustomers) * 100).toFixed(1))
            : 0,
        avg_messages_per_ticket:
          avgMessagesPerTicket.length > 0
            ? Number(avgMessagesPerTicket[0].avg.toFixed(1))
            : 0,
      },
      top_tickets_by_messages: await this.getTopTicketsByMessages(orgId),
      weekly: weeklyData.map((w) => ({
        week: formatWeekLabel(w._id),
        count: w.count,
      })),
      categories: categoryData.map((c) => ({
        category: c._id ? categoryMap.get(c._id.toString()) || 'Other' : 'Other',
        count: c.count,
      })),
      channel: channelData.map((c) => ({
        channel: channelLabelMap[c._id] || c._id || 'Unknown',
        count: c.count,
      })),
      priority: priorityData.map((p) => ({
        priority: p._id,
        count: p.count,
      })),
      status: statusData.map((s) => ({
        status: s._id,
        count: s.count,
      })),
      sentiment: sentimentData.map((s) => ({
        sentiment: s._id,
        count: s.count,
      })),
    };
  }

  /**
   * Top 5 tickets with the most messages (abuse detection)
   */
  private async getTopTicketsByMessages(orgId: Types.ObjectId) {
    const results = await this.threadModel.aggregate([
      { $match: { organizationId: orgId } },
      {
        $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'threadId',
          as: 'msgs',
          pipeline: [{ $count: 'c' }],
        },
      },
      {
        $project: {
          ticketId: 1,
          messageCount: {
            $ifNull: [{ $arrayElemAt: ['$msgs.c', 0] }, 0],
          },
        },
      },
      { $sort: { messageCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'tickets',
          localField: 'ticketId',
          foreignField: '_id',
          as: 'ticket',
          pipeline: [
            {
              $project: {
                displayId: 1,
                subject: 1,
                status: 1,
                channel: 1,
                customerId: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'customers',
          localField: 'ticket.customerId',
          foreignField: '_id',
          as: 'customer',
          pipeline: [{ $project: { firstName: 1, lastName: 1, email: 1 } }],
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ticketId: { $toString: '$ticketId' },
          displayId: '$ticket.displayId',
          subject: '$ticket.subject',
          status: '$ticket.status',
          channel: '$ticket.channel',
          customerName: {
            $concat: [
              { $ifNull: ['$customer.firstName', ''] },
              ' ',
              { $ifNull: ['$customer.lastName', ''] },
            ],
          },
          messageCount: 1,
        },
      },
    ]);

    return results;
  }

  /**
   * GET /analytics/pain-points
   * Returns frustration rates, sentiment, AI vs human by category
   */
  async getPainPoints(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);
    const categoryMap = await this.getCategoryMap(orgId);

    // Check if we have enough categorized tickets
    const categorizedCount = await this.ticketModel.countDocuments({
      organizationId: orgId,
      categoryId: { $exists: true, $ne: null },
    });
    const useCategories = categorizedCount >= 10;

    const [
      frustrationByCategory,
      sentimentData,
      aiRateByCategory,
      frustratedTicketSubjects,
    ] = await Promise.all([
      // Frustration rate by category (only when categories exist)
      useCategories
        ? this.ticketModel.aggregate([
            {
              $match: {
                organizationId: orgId,
                categoryId: { $exists: true, $ne: null },
                sentiment: { $exists: true, $ne: null },
              },
            },
            {
              $group: {
                _id: '$categoryId',
                total: { $sum: 1 },
                frustrated: {
                  $sum: {
                    $cond: [
                      { $in: ['$sentiment', ['frustrated', 'angry']] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
            { $match: { total: { $gte: 3 } } },
            { $sort: { frustrated: -1 } },
          ])
        : Promise.resolve([]),

      // Sentiment distribution
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            sentiment: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: '$sentiment', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // AI vs Human resolution by category (only when categories exist)
      useCategories
        ? this.ticketModel.aggregate([
            {
              $match: {
                organizationId: orgId,
                categoryId: { $exists: true, $ne: null },
                status: {
                  $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
                },
                resolutionType: { $exists: true, $ne: null },
              },
            },
            {
              $group: {
                _id: '$categoryId',
                total: { $sum: 1 },
                aiCount: {
                  $sum: {
                    $cond: [{ $eq: ['$resolutionType', 'ai'] }, 1, 0],
                  },
                },
              },
            },
            { $match: { total: { $gte: 3 } } },
            { $sort: { total: -1 } },
          ])
        : Promise.resolve([]),

      // Fetch frustrated ticket subjects for keyword extraction (fallback)
      this.ticketModel
        .find({
          organizationId: orgId,
          sentiment: { $in: ['frustrated', 'angry'] },
        })
        .select('subject')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    // Build pain points
    let painPoints: { title: string; description: string }[] = [];

    if (useCategories && frustrationByCategory.length > 0) {
      // Use category-based pain points
      painPoints = frustrationByCategory
        .filter((c) => c.frustrated > 0)
        .slice(0, 5)
        .map((c) => {
          const name = categoryMap.get(c._id.toString()) || 'Unknown';
          const pct = Number(((c.frustrated / c.total) * 100).toFixed(1));
          return {
            title: name,
            description: `${pct}% frustration rate across ${c.total} tickets.`,
          };
        });
    } else {
      // Extract common issue keywords from frustrated ticket subjects
      painPoints = this.extractPainPointsFromSubjects(
        frustratedTicketSubjects.map((t) => t.subject),
      );
    }

    // Frustration and AI rate: use categories if available, otherwise by channel
    let frustrationByCat: { category: string; frustrated_pct: number }[];
    let aiRateByCat: {
      category: string;
      ai_pct: number;
      human_pct: number;
    }[];

    if (useCategories) {
      frustrationByCat = frustrationByCategory.map((c) => ({
        category: categoryMap.get(c._id.toString()) || 'Other',
        frustrated_pct: Number(((c.frustrated / c.total) * 100).toFixed(1)),
      }));
      aiRateByCat = aiRateByCategory.map((c) => {
        const aiPct = Number(((c.aiCount / c.total) * 100).toFixed(1));
        return {
          category: categoryMap.get(c._id.toString()) || 'Other',
          ai_pct: aiPct,
          human_pct: Number((100 - aiPct).toFixed(1)),
        };
      });
    } else {
      // Fall back to channel-based for these charts
      const [frustByChannel, aiByChannel] = await Promise.all([
        this.ticketModel.aggregate([
          {
            $match: {
              organizationId: orgId,
              sentiment: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$channel',
              total: { $sum: 1 },
              frustrated: {
                $sum: {
                  $cond: [
                    { $in: ['$sentiment', ['frustrated', 'angry']] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $match: { total: { $gte: 3 } } },
          { $sort: { frustrated: -1 } },
        ]),
        this.ticketModel.aggregate([
          {
            $match: {
              organizationId: orgId,
              status: {
                $in: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
              },
              resolutionType: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$channel',
              total: { $sum: 1 },
              aiCount: {
                $sum: {
                  $cond: [{ $eq: ['$resolutionType', 'ai'] }, 1, 0],
                },
              },
            },
          },
          { $match: { total: { $gte: 3 } } },
          { $sort: { total: -1 } },
        ]),
      ]);

      const chLabel = (id: string) => {
        const m: Record<string, string> = {
          email: 'Email',
          whatsapp: 'WhatsApp',
          widget: 'Widget',
          sms: 'SMS',
          voice: 'Voice',
          api: 'API',
        };
        return m[id] || id || 'Unknown';
      };
      frustrationByCat = frustByChannel.map((c) => ({
        category: chLabel(c._id),
        frustrated_pct: Number(((c.frustrated / c.total) * 100).toFixed(1)),
      }));
      aiRateByCat = aiByChannel.map((c) => {
        const aiPct = Number(((c.aiCount / c.total) * 100).toFixed(1));
        return {
          category: chLabel(c._id),
          ai_pct: aiPct,
          human_pct: Number((100 - aiPct).toFixed(1)),
        };
      });
    }

    return {
      pain_points: painPoints,
      frustration_by_cat: frustrationByCat,
      sentiment: sentimentData.map((s) => ({
        sentiment: s._id,
        count: s.count,
      })),
      ai_rate_by_cat: aiRateByCat,
    };
  }

  /**
   * Extract top pain points from ticket subjects using keyword frequency
   */
  private extractPainPointsFromSubjects(
    subjects: string[],
  ): { title: string; description: string }[] {
    if (subjects.length === 0) return [];

    // Common stop words to ignore
    const stopWords = new Set([
      'i',
      'me',
      'my',
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'to',
      'of',
      'and',
      'in',
      'on',
      'for',
      'with',
      'at',
      'by',
      'from',
      'it',
      'this',
      'that',
      'not',
      'but',
      'or',
      'can',
      'do',
      'does',
      'did',
      'has',
      'have',
      'had',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'no',
      'so',
      'if',
      'about',
      'up',
      'out',
      'get',
      'got',
      'just',
      'been',
      'am',
      're',
      'fw',
      'fwd',
      'hi',
      'hello',
      'please',
      'help',
      'need',
      'want',
      'issue',
      'problem',
      'ticket',
      'request',
      'support',
      'customer',
      'dear',
      'sir',
      'madam',
      'thanks',
      'thank',
      'you',
      'your',
      'our',
      'we',
      'they',
      'he',
      'she',
      'how',
      'what',
      'when',
      'why',
      'where',
      'which',
      'who',
    ]);

    // Count bigrams (two-word phrases) for more meaningful topics
    const bigramCounts = new Map<string, number>();
    const wordCounts = new Map<string, number>();

    for (const subject of subjects) {
      const words = subject
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

      // Count individual meaningful words
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }

      // Count bigrams
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
      }
    }

    // Merge bigrams and single words, preferring bigrams
    const topics: { label: string; count: number }[] = [];
    const usedWords = new Set<string>();

    // Add top bigrams first
    const sortedBigrams = [...bigramCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    for (const [bigram, count] of sortedBigrams.slice(0, 8)) {
      topics.push({ label: bigram, count });
      bigram.split(' ').forEach((w) => usedWords.add(w));
    }

    // Add top single words that aren't already covered by bigrams
    const sortedWords = [...wordCounts.entries()]
      .filter(([word, count]) => count >= 3 && !usedWords.has(word))
      .sort((a, b) => b[1] - a[1]);

    for (const [word, count] of sortedWords.slice(0, 5)) {
      if (topics.length >= 5) break;
      topics.push({ label: word, count });
    }

    // Format as pain points
    return topics.slice(0, 5).map((t) => {
      const titleCase = t.label
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      return {
        title: titleCase,
        description: `Mentioned in ${t.count} of ${subjects.length} frustrated tickets.`,
      };
    });
  }

  /**
   * GET /analytics/ai-performance
   * Returns AI metrics, escalation reasons, confidence stats
   */
  async getAIPerformance(organizationId: string) {
    const orgId = new Types.ObjectId(organizationId);
    const resolvedStatuses = [TicketStatus.RESOLVED, TicketStatus.CLOSED];
    const categoryMap = await this.getCategoryMap(orgId);

    const [
      resolvedTickets,
      aiResolved,
      escalatedCount,
      totalTickets,
      aiMedianResult,
      humanMedianResult,
      aiReplyStats,
      confidenceStats,
      escalationReasons,
      aiRateByCategory,
    ] = await Promise.all([
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: resolvedStatuses },
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        status: { $in: resolvedStatuses },
        resolutionType: 'ai',
      }),
      this.ticketModel.countDocuments({
        organizationId: orgId,
        isAiEscalated: true,
      }),
      this.ticketModel.countDocuments({ organizationId: orgId }),

      // AI median resolution
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            resolutionType: 'ai',
            resolvedAt: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            durationMs: { $subtract: ['$resolvedAt', '$createdAt'] },
          },
        },
        { $sort: { durationMs: 1 } },
        { $group: { _id: null, durations: { $push: '$durationMs' } } },
      ]),

      // Human median resolution
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            resolutionType: 'human',
            resolvedAt: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            durationMs: { $subtract: ['$resolvedAt', '$createdAt'] },
          },
        },
        { $sort: { durationMs: 1 } },
        { $group: { _id: null, durations: { $push: '$durationMs' } } },
      ]),

      // Avg AI replies
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            resolutionType: 'ai',
            aiReplyCount: { $exists: true, $gt: 0 },
          },
        },
        { $group: { _id: null, avg: { $avg: '$aiReplyCount' } } },
      ]),

      // Confidence distribution
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            aiConfidenceScore: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            highConfidence: {
              $sum: { $cond: [{ $eq: ['$aiConfidenceScore', 100] }, 1, 0] },
            },
          },
        },
      ]),

      // Escalation reasons
      this.ticketModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            isAiEscalated: true,
            aiEscalationReason: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: '$aiEscalationReason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // AI resolution rate by category (fallback to channel)
      (async () => {
        const catCount = await this.ticketModel.countDocuments({
          organizationId: orgId,
          categoryId: { $exists: true, $ne: null },
        });
        const useCategories = catCount >= 10;
        const groupField = useCategories ? '$categoryId' : '$channel';
        const matchFilter = useCategories
          ? { categoryId: { $exists: true, $ne: null } }
          : {};
        const results = await this.ticketModel.aggregate([
          {
            $match: {
              organizationId: orgId,
              ...matchFilter,
              status: { $in: resolvedStatuses },
              resolutionType: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: groupField,
              total: { $sum: 1 },
              aiCount: {
                $sum: { $cond: [{ $eq: ['$resolutionType', 'ai'] }, 1, 0] },
              },
            },
          },
          { $match: { total: { $gte: 3 } } },
          { $sort: { total: -1 } },
        ]);
        return { results, useCategories };
      })(),
    ]);

    const computeMedianHrs = (result: any[]): number => {
      if (result.length === 0) return 0;
      const durations = result[0].durations as number[];
      if (durations.length === 0) return 0;
      const mid = Math.floor(durations.length / 2);
      const medianMs =
        durations.length % 2 === 0
          ? (durations[mid - 1] + durations[mid]) / 2
          : durations[mid];
      return Number((medianMs / (1000 * 60 * 60)).toFixed(1));
    };

    const aiMedianHrs = computeMedianHrs(aiMedianResult);
    const humanMedianHrs = computeMedianHrs(humanMedianResult);
    const speedAdvantage =
      aiMedianHrs > 0 ? Number((humanMedianHrs / aiMedianHrs).toFixed(1)) : 0;

    const aiResolutionRate =
      resolvedTickets > 0
        ? Number(((aiResolved / resolvedTickets) * 100).toFixed(1))
        : 0;
    const escalationRate =
      totalTickets > 0
        ? Number(((escalatedCount / totalTickets) * 100).toFixed(1))
        : 0;
    const avgAiReplies =
      aiReplyStats.length > 0
        ? Number(aiReplyStats[0].avg.toFixed(1))
        : 0;
    const highConfidencePct =
      confidenceStats.length > 0
        ? Number(
            (
              (confidenceStats[0].highConfidence / confidenceStats[0].total) *
              100
            ).toFixed(1),
          )
        : 0;

    // Bucket escalation reasons into readable groups
    const reasonBuckets = new Map<string, number>();
    for (const r of escalationReasons) {
      const raw = (r._id as string).toLowerCase();
      let label: string;
      if (raw.includes('confidence')) label = 'Low Confidence Score';
      else if (raw.includes('loop') || raw.includes('exhausted'))
        label = 'Agent Loop Exhausted';
      else if (raw.includes('error') || raw.includes('billing'))
        label = 'API/Billing Error';
      else if (raw.includes('limit') || raw.includes('auto-reply'))
        label = 'Auto-Reply Limit Reached';
      else label = r._id as string;

      reasonBuckets.set(label, (reasonBuckets.get(label) || 0) + r.count);
    }

    return {
      kpis: {
        ai_resolution_rate: aiResolutionRate,
        ai_median_hrs: aiMedianHrs,
        human_median_hrs: humanMedianHrs,
        speed_advantage: speedAdvantage,
        avg_ai_replies: avgAiReplies,
        high_confidence_pct: highConfidencePct,
        escalation_rate: escalationRate,
        escalated_count: escalatedCount,
      },
      escalation_reasons: Array.from(reasonBuckets.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      ai_rate_by_cat: (aiRateByCategory as any).results.map((c: any) => {
        const aiPct = Number(((c.aiCount / c.total) * 100).toFixed(1));
        const channelLabels: Record<string, string> = {
          email: 'Email',
          whatsapp: 'WhatsApp',
          widget: 'Widget',
          sms: 'SMS',
          voice: 'Voice',
          api: 'API',
        };
        const label = (aiRateByCategory as any).useCategories
          ? categoryMap.get(c._id?.toString()) || 'Other'
          : channelLabels[c._id] || c._id || 'Unknown';
        return {
          category: label,
          ai_pct: aiPct,
          human_pct: Number((100 - aiPct).toFixed(1)),
        };
      }),
    };
  }

  /**
   * GET /analytics/agent-performance?agentId=
   * Returns per-agent detailed stats, or list of all agents with summary
   */
  async getAgentPerformance(organizationId: string, agentId?: string) {
    const orgId = new Types.ObjectId(organizationId);
    const resolvedStatuses = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

    // If no agentId, return list of all agents with summary stats
    if (!agentId) {
      const agents = await this.userModel
        .find({ organizationId: orgId })
        .select('_id firstName lastName email role')
        .lean();

      const agentSummaries = await Promise.all(
        agents.map(async (agent) => {
          const agentObjId = new Types.ObjectId(agent._id as unknown as string);
          const [totalAssigned, resolved, humanTickets] = await Promise.all([
            this.ticketModel.countDocuments({
              organizationId: orgId,
              assignedToId: agentObjId,
            }),
            this.ticketModel.countDocuments({
              organizationId: orgId,
              assignedToId: agentObjId,
              status: { $in: resolvedStatuses },
            }),
            this.ticketModel.countDocuments({
              organizationId: orgId,
              assignedToId: agentObjId,
              resolutionType: 'human',
            }),
          ]);

          if (totalAssigned === 0) return null;

          return {
            id: agent._id.toString(),
            name: `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.email,
            role: agent.role,
            totalAssigned,
            humanTickets,
            resolved,
            resolutionRate:
              totalAssigned > 0
                ? Number(((resolved / totalAssigned) * 100).toFixed(1))
                : 0,
          };
        }),
      );

      return {
        agents: agentSummaries.filter(Boolean),
      };
    }

    // Detailed agent performance
    const agentObjId = new Types.ObjectId(agentId);
    const categoryMap = await this.getCategoryMap(orgId);

    const agent = await this.userModel
      .findById(agentObjId)
      .select('firstName lastName email role')
      .lean();

    if (!agent) return { error: 'Agent not found' };

    const baseMatch = { organizationId: orgId, assignedToId: agentObjId };

    const [
      totalAssigned,
      resolved,
      humanTickets,
      openCount,
      pendingCount,
      escalatedCount,
      resolutionDurations,
      firstResponseTimes,
      frustratedCount,
      gratefulCount,
      channelData,
      priorityData,
      categoryData,
      weeklyData,
      hourlyData,
      dayOfWeekData,
      sentimentTotal,
    ] = await Promise.all([
      this.ticketModel.countDocuments(baseMatch),
      this.ticketModel.countDocuments({
        ...baseMatch,
        status: { $in: resolvedStatuses },
      }),
      this.ticketModel.countDocuments({
        ...baseMatch,
        resolutionType: 'human',
      }),
      this.ticketModel.countDocuments({
        ...baseMatch,
        status: TicketStatus.OPEN,
      }),
      this.ticketModel.countDocuments({
        ...baseMatch,
        status: TicketStatus.PENDING,
      }),
      this.ticketModel.countDocuments({
        ...baseMatch,
        status: TicketStatus.ESCALATED,
      }),

      // Resolution durations for speed buckets + median/avg/p90
      this.ticketModel.aggregate([
        {
          $match: {
            ...baseMatch,
            status: { $in: resolvedStatuses },
            resolvedAt: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            durationMs: { $subtract: ['$resolvedAt', '$createdAt'] },
          },
        },
        { $sort: { durationMs: 1 } },
        { $group: { _id: null, durations: { $push: '$durationMs' } } },
      ]),

      // First response times
      this.ticketModel.aggregate([
        {
          $match: {
            ...baseMatch,
            firstResponseAt: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            responseMs: { $subtract: ['$firstResponseAt', '$createdAt'] },
          },
        },
        { $sort: { responseMs: 1 } },
        { $group: { _id: null, times: { $push: '$responseMs' } } },
      ]),

      // Frustrated
      this.ticketModel.countDocuments({
        ...baseMatch,
        sentiment: { $in: ['frustrated', 'angry'] },
      }),

      // Grateful
      this.ticketModel.countDocuments({
        ...baseMatch,
        sentiment: 'grateful',
      }),

      // Channels
      this.ticketModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Priority
      this.ticketModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Top categories
      this.ticketModel.aggregate([
        {
          $match: {
            ...baseMatch,
            categoryId: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),

      // Weekly volume (last 8 weeks)
      this.ticketModel.aggregate([
        {
          $match: {
            ...baseMatch,
            createdAt: {
              $gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: {
                  $dateFromParts: {
                    isoWeekYear: { $isoWeekYear: '$createdAt' },
                    isoWeek: { $isoWeek: '$createdAt' },
                    isoDayOfWeek: 1,
                  },
                },
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Hourly distribution (24 buckets)
      this.ticketModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Day of week
      this.ticketModel.aggregate([
        { $match: baseMatch },
        {
          $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } },
        },
        { $sort: { _id: 1 } },
      ]),

      // Total with sentiment (for percentage calc)
      this.ticketModel.countDocuments({
        ...baseMatch,
        sentiment: { $exists: true, $ne: null },
      }),
    ]);

    // Compute stats from duration arrays
    const computeStats = (result: any[], field = 'durations') => {
      if (result.length === 0 || result[0][field].length === 0) {
        return { median: 0, avg: 0, p90: 0 };
      }
      const arr = result[0][field] as number[];
      const mid = Math.floor(arr.length / 2);
      const median =
        arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const p90Index = Math.floor(arr.length * 0.9);
      const p90 = arr[p90Index] || arr[arr.length - 1];
      return {
        median: Number((median / (1000 * 60 * 60)).toFixed(1)),
        avg: Number((avg / (1000 * 60 * 60)).toFixed(1)),
        p90: Number((p90 / (1000 * 60 * 60)).toFixed(1)),
      };
    };

    const resStats = computeStats(resolutionDurations);
    const firstRespStats =
      firstResponseTimes.length > 0 && firstResponseTimes[0].times.length > 0
        ? (() => {
            const arr = firstResponseTimes[0].times as number[];
            const mid = Math.floor(arr.length / 2);
            const median =
              arr.length % 2 === 0
                ? (arr[mid - 1] + arr[mid]) / 2
                : arr[mid];
            return Number((median / (1000 * 60)).toFixed(1)); // minutes
          })()
        : 0;

    // Speed buckets
    const ONE_HOUR = 1000 * 60 * 60;
    const ONE_DAY = ONE_HOUR * 24;
    const THREE_DAYS = ONE_DAY * 3;
    const speedBuckets = [
      { label: '< 1 hour', value: 0 },
      { label: '1\u201324 hours', value: 0 },
      { label: '1\u20133 days', value: 0 },
      { label: '3+ days', value: 0 },
    ];

    if (resolutionDurations.length > 0) {
      for (const d of resolutionDurations[0].durations as number[]) {
        if (d < ONE_HOUR) speedBuckets[0].value++;
        else if (d < ONE_DAY) speedBuckets[1].value++;
        else if (d < THREE_DAYS) speedBuckets[2].value++;
        else speedBuckets[3].value++;
      }
    }

    // Priority buckets matching mock format
    const highUrgent =
      priorityData
        .filter((p) => p._id === 'high' || p._id === 'urgent')
        .reduce((sum, p) => sum + p.count, 0);
    const mediumCount =
      priorityData.find((p) => p._id === 'medium')?.count || 0;
    const lowCount = priorityData.find((p) => p._id === 'low')?.count || 0;

    // Hourly array (24 slots)
    const hourly = new Array(24).fill(0);
    for (const h of hourlyData) {
      hourly[h._id] = h.count;
    }

    // Day of week (MongoDB: 1=Sunday, 2=Monday, ..., 7=Saturday)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeekMap = new Map<number, number>();
    for (const d of dayOfWeekData) {
      dayOfWeekMap.set(d._id, d.count);
    }
    const dayOfWeek = [2, 3, 4, 5, 6, 7, 1].map((mongoDay) => ({
      day: dayNames[mongoDay - 1],
      count: dayOfWeekMap.get(mongoDay) || 0,
    }));

    const channelLabelMap: Record<string, string> = {
      email: 'Email',
      whatsapp: 'WhatsApp',
      widget: 'Widget',
      sms: 'SMS',
      voice: 'Voice',
      api: 'API',
    };

    const formatWeekLabel = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    };

    return {
      name:
        `${agent.firstName || ''} ${agent.lastName || ''}`.trim() ||
        agent.email,
      role: agent.role,
      humanTickets,
      totalAssigned,
      resolved,
      open: openCount,
      pending: pendingCount,
      escalated: escalatedCount,
      resolutionRate:
        totalAssigned > 0
          ? Number(((resolved / totalAssigned) * 100).toFixed(1))
          : 0,
      medianResolutionHrs: resStats.median,
      avgResolutionHrs: resStats.avg,
      p90ResolutionHrs: resStats.p90,
      medianFirstResponseMin: firstRespStats,
      frustratedPct:
        sentimentTotal > 0
          ? Number(((frustratedCount / sentimentTotal) * 100).toFixed(1))
          : 0,
      frustratedCount,
      gratefulPct:
        sentimentTotal > 0
          ? Number(((gratefulCount / sentimentTotal) * 100).toFixed(1))
          : 0,
      gratefulCount,
      highUrgentPct:
        totalAssigned > 0
          ? Number(((highUrgent / totalAssigned) * 100).toFixed(1))
          : 0,
      speedBuckets,
      priority: [
        { label: 'High/Urgent', count: highUrgent },
        { label: 'Medium', count: mediumCount },
        { label: 'Low', count: lowCount },
      ],
      channels: channelData.map((c) => ({
        channel: channelLabelMap[c._id] || c._id || 'Unknown',
        count: c.count,
      })),
      topCategories: categoryData.map((c) => ({
        category: c._id
          ? categoryMap.get(c._id.toString()) || 'Other'
          : 'Other',
        count: c.count,
      })),
      weekly: weeklyData.map((w) => ({
        week: formatWeekLabel(w._id),
        count: w.count,
      })),
      hourly,
      dayOfWeek,
    };
  }
}
