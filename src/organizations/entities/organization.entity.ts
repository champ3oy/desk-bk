import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type OrganizationDocument = Organization & Document;

@Schema({ timestamps: true })
export class Organization {
  @ApiProperty({
    description: 'Organization name',
    example: 'Acme Corporation',
  })
  @Prop({ required: true })
  name: string;

  @ApiPropertyOptional({
    description: 'Organization description',
    example: 'A leading technology company',
  })
  @Prop({ required: false })
  description?: string;

  @ApiPropertyOptional()
  @Prop()
  slug?: string;

  @ApiPropertyOptional()
  @Prop()
  ownerId?: string; // Stored as string or ObjectId

  @ApiProperty({
    description: 'Whether organization is active',
    example: true,
  })
  @Prop({ default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Whether AI auto-reply using draft responses is enabled',
    example: false,
  })
  @Prop({ default: false })
  aiAutoReplyEmail: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for social media',
    example: false,
  })
  @Prop({ default: false })
  aiAutoReplySocialMedia: boolean;

  @ApiPropertyOptional({
    description: 'Whether AI auto-reply is enabled for live chat',
    example: false,
  })
  @Prop({ default: false })
  aiAutoReplyLiveChat: boolean;

  @ApiPropertyOptional({
    description: 'Confidence threshold for auto-replies (0-100)',
    example: 85,
  })
  @Prop({ default: 85 })
  aiConfidenceThreshold: number;

  @ApiPropertyOptional({
    description: 'Restricted topics for AI auto-reply',
    example: ['Billing', 'Refunds'],
    type: [String],
  })
  @Prop({ type: [String], default: [] })
  aiRestrictedTopics: string[];

  @ApiPropertyOptional({
    description: 'Whether AI should learn from closed tickets',
    example: true,
  })
  @Prop({ default: true })
  aiLearnFromTickets: boolean;

  @ApiPropertyOptional({
    description: 'AI Persona Prompt',
    example: 'You are a helpful assistant...',
  })
  @Prop({ required: false })
  aiPersonalityPrompt?: string;

  @ApiPropertyOptional({
    description: 'AI Formality Level (0-100)',
    example: 50,
  })
  @Prop({ default: 50 })
  aiFormality: number;

  @ApiPropertyOptional({
    description: 'AI Response Length (0-100)',
    example: 50,
  })
  @Prop({ default: 50 })
  aiResponseLength: number;

  @ApiPropertyOptional({
    description: 'AI Empathy Level (0-100)',
    example: 50,
  })
  @Prop({ default: 50 })
  aiEmpathy: number;

  @ApiPropertyOptional({
    description: 'Whether to use emojis in AI responses',
    example: false,
  })
  @Prop({ default: false })
  aiUseEmojis: boolean;

  @ApiPropertyOptional({
    description: 'Whether to include greetings in AI responses',
    example: true,
  })
  @Prop({ default: true })
  aiIncludeGreetings: boolean;

  @ApiPropertyOptional({
    description: 'Whether to include sign-off in AI responses',
    example: true,
  })
  @Prop({ default: true })
  aiIncludeSignOff: boolean;

  @ApiPropertyOptional({
    description: 'Words/phrases to use in AI responses',
    example: 'Thanks, Happy to help',
  })
  @Prop({ required: false })
  aiWordsToUse?: string;

  @ApiPropertyOptional({
    description: 'Words/phrases to avoid in AI responses',
    example: "I don't know, No problem",
  })
  @Prop({ required: false })
  aiWordsToAvoid?: string;

  @ApiPropertyOptional({
    description: 'Email signature for AI auto-replies',
    example: 'Best regards,\nAI Support Agent',
  })
  @Prop({ required: false })
  aiEmailSignature?: string;

  @ApiPropertyOptional({
    description: 'Support email address for routing incoming messages',
    example: 'support@acme.com',
  })
  @Prop({ required: false })
  supportEmail?: string;

  @ApiPropertyOptional({
    description: 'Support phone number for routing incoming messages',
    example: '+1234567890',
  })
  @Prop({ required: false })
  supportPhone?: string;

  @ApiPropertyOptional({
    description: 'Additional email addresses for routing (array)',
    type: [String],
    example: ['help@acme.com', 'info@acme.com'],
  })
  @Prop({ type: [String], default: [] })
  additionalEmails?: string[];

  @ApiPropertyOptional({
    description: 'Additional phone numbers for routing (array)',
    type: [String],
    example: ['+1987654321'],
  })
  @Prop({ type: [String], default: [] })
  additionalPhones?: string[];

  @ApiPropertyOptional({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;

  @ApiPropertyOptional({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt?: Date;

  @ApiPropertyOptional({
    description: 'Subscription Plan',
    example: 'STARTER',
  })
  @Prop({ default: 'STARTER' })
  plan: string;

  @ApiPropertyOptional({
    description: 'Billing Email',
    example: 'billing@acme.com',
  })
  @Prop()
  billingEmail?: string;
  @ApiPropertyOptional({
    description: 'Widget configuration settings',
  })
  @Prop({
    type: {
      primaryColor: { type: String, default: '#06B6D4' },
      secondaryColor: { type: String, default: '#0F2035' },
      position: { type: String, default: 'bottom-right' },
      size: { type: String, default: 'medium' },
      borderRadius: { type: String, default: 'rounded' },
      logoUrl: { type: String, default: '' },
      customCSS: { type: String, default: '' },
      welcomeMessage: {
        type: String,
        default: 'Hello! How can I help you today?',
      },
      headerText: { type: String, default: 'Chat with us' },
    },
    default: {},
    _id: false,
  })
  widgetConfig?: {
    primaryColor?: string;
    secondaryColor?: string;
    position?: string;
    size?: string;
    borderRadius?: string;
    logoUrl?: string;
    customCSS?: string;
    welcomeMessage?: string;
    headerText?: string;
  };

  @ApiPropertyOptional({ description: 'Payment method info' })
  @Prop({
    type: {
      brand: String,
      last4: String,
      expiry: String,
    },
    default: {
      brand: 'Visa',
      last4: '4242',
      expiry: '12/25',
    },
    _id: false,
  })
  paymentMethod?: {
    brand: string;
    last4: string;
    expiry: string;
  };
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
