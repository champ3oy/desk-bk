import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrgAnalyticsDocument = OrgAnalytics & Document;

@Schema({ timestamps: true })
export class OrgAnalytics {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ type: Object })
  summary: any;

  @Prop({ type: Array })
  trendingTopics: any[];

  @Prop({ type: Object })
  sentimentHealth: any;

  @Prop({ type: Object })
  autopilotROI: any;

  @Prop({ type: Date, default: Date.now })
  lastUpdatedAt: Date;
}

export const OrgAnalyticsSchema = SchemaFactory.createForClass(OrgAnalytics);
