import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
import { analyzeSentiment } from './agents/sentiment';
import { summarizeTicket } from './agents/summary';
import { TicketsService } from '../tickets/tickets.service';
import { ThreadsService } from '../threads/threads.service';
import { CommentsService } from '../comments/comments.service';
import { DraftResponseDto, DraftResponseResponseDto } from './dto/draft-response.dto';
import {
  AnalyzeSentimentDto,
  AnalyzeSentimentResponseDto,
} from './dto/analyze-sentiment.dto';
import {
  SummarizeTicketDto,
  SummarizeTicketResponseDto,
} from './dto/summarize-ticket.dto';

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
  ) {}

  @Post('draft-response')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Draft a response for a ticket',
    description:
      'Uses AI to draft a professional customer support response based on ticket context, including all threads and messages',
  })
  @ApiBody({ type: DraftResponseDto })
  @ApiResponse({
    status: 200,
    description: 'AI-generated response draft',
    type: DraftResponseResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async draftResponse(@Body() body: DraftResponseDto, @Request() req) {
    return await draftResponse(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.configService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
      body.context,
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
}

