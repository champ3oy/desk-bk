import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Comment } from './entities/comment.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Comments')
@ApiBearerAuth('JWT-auth')
@Controller('comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment' })
  @ApiBody({ type: CreateCommentDto })
  @ApiCreatedResponse({
    description: 'Comment successfully created',
    type: Comment,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createCommentDto: CreateCommentDto, @Request() req) {
    if (
      req.user.role === UserRole.LIGHT_AGENT &&
      !createCommentDto.isInternal
    ) {
      throw new ForbiddenException(
        'Light agents can only create internal comments',
      );
    }
    return this.commentsService.create(createCommentDto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all comments for a ticket' })
  @ApiQuery({ name: 'ticketId', required: true, description: 'Ticket ID' })
  @ApiResponse({
    status: 200,
    description: 'List of comments',
    type: [Comment],
  })
  findAll(@Query('ticketId') ticketId: string, @Request() req) {
    return this.commentsService.findAll(
      ticketId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a comment by ID' })
  @ApiParam({ name: 'id', description: 'Comment ID' })
  @ApiResponse({ status: 200, description: 'Comment details', type: Comment })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.commentsService.findOne(id, req.user.userId, req.user.role);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a comment' })
  @ApiParam({ name: 'id', description: 'Comment ID' })
  @ApiBody({ type: UpdateCommentDto })
  @ApiResponse({
    status: 200,
    description: 'Comment successfully updated',
    type: Comment,
  })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  update(
    @Param('id') id: string,
    @Body() updateCommentDto: UpdateCommentDto,
    @Request() req,
  ) {
    return this.commentsService.update(
      id,
      updateCommentDto,
      req.user.userId,
      req.user.role,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiParam({ name: 'id', description: 'Comment ID' })
  @ApiResponse({ status: 200, description: 'Comment successfully deleted' })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  remove(@Param('id') id: string, @Request() req) {
    return this.commentsService.remove(id, req.user.userId, req.user.role);
  }
}
