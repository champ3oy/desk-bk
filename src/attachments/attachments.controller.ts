import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
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
} from '@nestjs/swagger';
import { AttachmentsService } from './attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Attachment } from './entities/attachment.entity';

@ApiTags('Attachments')
@ApiBearerAuth('JWT-auth')
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new attachment' })
  @ApiBody({ type: CreateAttachmentDto })
  @ApiCreatedResponse({ description: 'Attachment successfully created', type: Attachment })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createAttachmentDto: CreateAttachmentDto) {
    return this.attachmentsService.create(createAttachmentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all attachments' })
  @ApiQuery({ name: 'ticketId', required: false, description: 'Filter by ticket ID' })
  @ApiQuery({ name: 'commentId', required: false, description: 'Filter by comment ID' })
  @ApiResponse({ status: 200, description: 'List of attachments', type: [Attachment] })
  findAll(@Query('ticketId') ticketId?: string, @Query('commentId') commentId?: string) {
    return this.attachmentsService.findAll(ticketId, commentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an attachment by ID' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({ status: 200, description: 'Attachment details', type: Attachment })
  @ApiNotFoundResponse({ description: 'Attachment not found' })
  findOne(@Param('id') id: string) {
    return this.attachmentsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an attachment' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({ status: 200, description: 'Attachment successfully deleted' })
  @ApiNotFoundResponse({ description: 'Attachment not found' })
  remove(@Param('id') id: string) {
    return this.attachmentsService.remove(id);
  }
}

