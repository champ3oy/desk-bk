import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Request,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new attachment' })
  @ApiBody({ type: CreateAttachmentDto })
  @ApiCreatedResponse({
    description: 'Attachment successfully created',
    type: Attachment,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createAttachmentDto: CreateAttachmentDto, @Request() req) {
    console.log('[AttachmentsController] create req.user:', req.user);
    return this.attachmentsService.create(
      createAttachmentDto,
      req.user.organizationId,
    );
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a file' })
  @ApiResponse({
    status: 201,
    description: 'File successfully uploaded',
    type: Attachment,
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
    @Body('ticketId') ticketId?: string,
  ) {
    console.log('[AttachmentsController] upload req.user:', req.user);
    return this.attachmentsService.uploadFile(
      file,
      req.user.organizationId,
      ticketId,
    );
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiResponse({
    status: 201,
    description: 'Files successfully uploaded',
    type: [Attachment],
  })
  uploadMultiple(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Request() req,
    @Body('ticketId') ticketId?: string,
    @Body('organizationId') organizationId?: string,
  ) {
    console.log(
      '[AttachmentsController] uploadMultiple req.user:',
      req.user,
      'body.organizationId:',
      organizationId,
      'body.ticketId:',
      ticketId,
    );
    // Use organizationId from body if req.user is missing,
    // or it will be resolved from ticketId in the service.
    return this.attachmentsService.uploadFiles(
      files,
      req.user?.organizationId || organizationId,
      ticketId,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all attachments' })
  @ApiQuery({
    name: 'ticketId',
    required: false,
    description: 'Filter by ticket ID',
  })
  @ApiQuery({
    name: 'commentId',
    required: false,
    description: 'Filter by comment ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of attachments',
    type: [Attachment],
  })
  findAll(
    @Query('ticketId') ticketId?: string,
    @Query('commentId') commentId?: string,
  ) {
    return this.attachmentsService.findAll(ticketId, commentId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get an attachment by ID' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({
    status: 200,
    description: 'Attachment details',
    type: Attachment,
  })
  @ApiNotFoundResponse({ description: 'Attachment not found' })
  findOne(@Param('id') id: string) {
    return this.attachmentsService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete an attachment' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({ status: 200, description: 'Attachment successfully deleted' })
  @ApiNotFoundResponse({ description: 'Attachment not found' })
  remove(@Param('id') id: string) {
    return this.attachmentsService.remove(id);
  }
}
