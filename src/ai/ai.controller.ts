import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Patch,
} from '@nestjs/common';
import { AIModelFactory } from './ai-model.factory';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { draftResponse } from './agents/response';
import { draftHumanResponse } from './agents/draft-human-response';
import { analyzeSentiment } from './agents/sentiment';
import { summarizeTicket } from './agents/summary';
import { briefSummary } from './agents/summary/brief';
import { TicketsService } from '../tickets/tickets.service';
import { ThreadsService } from '../threads/threads.service';
import { CommentsService } from '../comments/comments.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CustomersService } from '../customers/customers.service';
import {
  DraftResponseDto,
  DraftResponseResponseDto,
} from './dto/draft-response.dto';
import {
  AnalyzeSentimentDto,
  AnalyzeSentimentResponseDto,
} from './dto/analyze-sentiment.dto';
import {
  SummarizeTicketDto,
  SummarizeTicketResponseDto,
} from './dto/summarize-ticket.dto';
import { UpdatePersonalityConfigDto } from './dto/update-personality-config.dto';
import { UpdateResponseConfigDto } from './dto/update-response-config.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import {
  PlaygroundChatDto,
  PlaygroundChatResponseDto,
} from './dto/playground-chat.dto';
import { playgroundChat } from './agents/playground';
import {
  GenerateInstructionsDto,
  GenerateInstructionsResponseDto,
} from './dto/generate-instructions.dto';
import { generateInstructions } from './agents/generate-instructions';

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly threadsService: ThreadsService,
    private readonly commentsService: CommentsService,
    private readonly configService: ConfigService,
    private readonly organizationsService: OrganizationsService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly customersService: CustomersService,
  ) {}

  @Post('generate-instructions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate system instructions',
    description:
      'Uses AI to generate system instructions based on personality description and parameters',
  })
  @ApiBody({ type: GenerateInstructionsDto })
  @ApiResponse({
    status: 200,
    description: 'Generated system instructions',
    type: GenerateInstructionsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateInstructions(
    @Body() body: GenerateInstructionsDto,
    @Request() req,
  ) {
    return await generateInstructions(
      body.description,
      body.formality,
      body.empathy,
      body.verbosity,
      this.configService,
    );
  }

  @Post('draft-response')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Draft a response for human agent',
    description:
      'Uses AI to draft a helpful customer support response for a human agent to review and send. This does not make auto-reply decisions - it simply provides a draft message.',
  })
  @ApiBody({ type: DraftResponseDto })
  @ApiResponse({
    status: 200,
    description: 'AI-generated response draft for human review',
    type: DraftResponseResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async draftResponse(@Body() body: DraftResponseDto, @Request() req) {
    return await draftHumanResponse(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.commentsService,
      this.configService,
      this.organizationsService,
      this.knowledgeBaseService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
      body.context,
      body.channel,
    );
  }

  @Post('analyze-sentiment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Analyze sentiment of a ticket',
    description:
      'Uses AI to analyze the emotional tone and sentiment of customer communications in a ticket',
  })
  @ApiBody({ type: AnalyzeSentimentDto })
  @ApiResponse({
    status: 200,
    description: 'Sentiment analysis result',
    type: AnalyzeSentimentResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async analyzeSentiment(@Body() body: AnalyzeSentimentDto, @Request() req) {
    return await analyzeSentiment(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.commentsService,
      this.configService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Post('summarize-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Summarize a ticket',
    description:
      'Uses AI to generate a comprehensive summary of a ticket including all threads, messages, and comments',
  })
  @ApiBody({ type: SummarizeTicketDto })
  @ApiResponse({
    status: 200,
    description: 'AI-generated ticket summary',
    type: SummarizeTicketResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async summarizeTicket(@Body() body: SummarizeTicketDto, @Request() req) {
    return await summarizeTicket(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.commentsService,
      this.configService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Post('brief-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a brief one-sentence summary of a ticket',
    description: 'Uses AI to generate a very short, one-sentence summary',
  })
  @ApiBody({ type: SummarizeTicketDto })
  @ApiResponse({
    status: 200,
    description: 'AI-generated brief summary',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async briefSummary(@Body() body: SummarizeTicketDto, @Request() req) {
    return await briefSummary(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.configService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Get('personality-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get AI personality configuration',
    description:
      'Retrieves the current AI personality settings for the organization',
  })
  @ApiResponse({
    status: 200,
    description: 'AI personality configuration',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPersonalityConfig(@Request() req) {
    const org = await this.organizationsService.findOne(
      req.user.organizationId,
    );

    return {
      aiPersonalityPrompt: org.aiPersonalityPrompt,
      aiFormality: org.aiFormality,
      aiEmpathy: org.aiEmpathy,
      aiResponseLength: org.aiResponseLength,
      aiUseEmojis: org.aiUseEmojis,
      aiIncludeGreetings: org.aiIncludeGreetings,
      aiIncludeSignOff: org.aiIncludeSignOff,
      aiWordsToUse: org.aiWordsToUse,
      aiWordsToAvoid: org.aiWordsToAvoid,
    };
  }

  @Patch('personality-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update AI personality configuration',
    description: 'Updates the AI personality settings for the organization',
  })
  @ApiBody({ type: UpdatePersonalityConfigDto })
  @ApiResponse({
    status: 200,
    description: 'AI personality configuration updated successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePersonalityConfig(
    @Body() updateDto: UpdatePersonalityConfigDto,
    @Request() req,
  ) {
    const updatedOrg = await this.organizationsService.update(
      req.user.organizationId,
      updateDto,
    );

    return {
      aiPersonalityPrompt: updatedOrg.aiPersonalityPrompt,
      aiFormality: updatedOrg.aiFormality,
      aiEmpathy: updatedOrg.aiEmpathy,
      aiResponseLength: updatedOrg.aiResponseLength,
      aiUseEmojis: updatedOrg.aiUseEmojis,
      aiIncludeGreetings: updatedOrg.aiIncludeGreetings,
      aiIncludeSignOff: updatedOrg.aiIncludeSignOff,
      aiWordsToUse: updatedOrg.aiWordsToUse,
      aiWordsToAvoid: updatedOrg.aiWordsToAvoid,
    };
  }

  @Get('response-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get AI response configuration',
    description:
      'Retrieves the current AI response settings for the organization',
  })
  @ApiResponse({
    status: 200,
    description: 'AI response configuration',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getResponseConfig(@Request() req) {
    const org = await this.organizationsService.findOne(
      req.user.organizationId,
    );

    return {
      aiLearnFromTickets: org.aiLearnFromTickets,
      aiAutoReplyEmail: org.aiAutoReplyEmail,
      aiAutoReplySocialMedia: org.aiAutoReplySocialMedia,
      aiAutoReplyLiveChat: org.aiAutoReplyLiveChat,
      aiConfidenceThreshold: org.aiConfidenceThreshold,
      aiRestrictedTopics: org.aiRestrictedTopics,
      aiEmailSignature: org.aiEmailSignature,
    };
  }

  @Patch('response-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update AI response configuration',
    description: 'Updates the AI response settings for the organization',
  })
  @ApiBody({ type: UpdateResponseConfigDto })
  @ApiResponse({
    status: 200,
    description: 'AI response configuration updated successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateResponseConfig(
    @Body() updateDto: UpdateResponseConfigDto,
    @Request() req,
  ) {
    const updatedOrg = await this.organizationsService.update(
      req.user.organizationId,
      updateDto,
    );

    return {
      aiLearnFromTickets: updatedOrg.aiLearnFromTickets,
      aiAutoReplyEmail: updatedOrg.aiAutoReplyEmail,
      aiAutoReplySocialMedia: updatedOrg.aiAutoReplySocialMedia,
      aiAutoReplyLiveChat: updatedOrg.aiAutoReplyLiveChat,
      aiConfidenceThreshold: updatedOrg.aiConfidenceThreshold,
      aiRestrictedTopics: updatedOrg.aiRestrictedTopics,
      aiEmailSignature: updatedOrg.aiEmailSignature,
    };
  }
  @Get('models')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available AI models',
    description: 'Retrieves the list of configured and available AI models',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available AI models',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAvailableModels(@Request() req) {
    return AIModelFactory.getAvailableModels(this.configService);
  }

  @Post('playground-chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chat with the AI in playground mode',
    description:
      'Simulates a chat conversation with the AI using the organization personality settings',
  })
  @ApiBody({ type: PlaygroundChatDto })
  @ApiResponse({
    status: 200,
    description: 'AI response',
    type: PlaygroundChatResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async playgroundChat(@Body() body: PlaygroundChatDto, @Request() req) {
    return await playgroundChat(
      body.message,
      this.configService,
      this.organizationsService,
      this.knowledgeBaseService,
      this.customersService,
      req.user.organizationId,
      body.history,
      body.provider,
      body.model,
      body.customerEmail,
    );
  }
}
