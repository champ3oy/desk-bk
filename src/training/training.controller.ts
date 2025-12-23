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
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TrainingService } from './training.service';
import { CreateTrainingSourceDto } from './dto/create-training-source.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('Training')
@ApiBearerAuth('JWT-auth')
@Controller('training')
@UseGuards(JwtAuthGuard)
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new training source' })
  @ApiResponse({
    status: 201,
    description: 'The source has been successfully created.',
  })
  async create(
    @Body() createTrainingSourceDto: CreateTrainingSourceDto,
    @Request() req,
  ) {
    return this.trainingService.create(
      createTrainingSourceDto,
      req.user.organizationId,
    );
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a file for training' })
  @ApiResponse({
    status: 201,
    description: 'The file has been uploaded and processed.',
  })
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Request() req) {
    return this.trainingService.processFile(file, req.user.organizationId);
  }

  @Post('scan-website')
  @ApiOperation({ summary: 'Scan a website for pages' })
  @ApiResponse({
    status: 200,
    description: 'Returns a list of pages found on the website.',
  })
  async scanWebsite(@Body('url') url: string) {
    return this.trainingService.scanWebsite(url);
  }

  @Get()
  @ApiOperation({ summary: 'List all training sources for the organization' })
  async findAll(@Request() req) {
    return this.trainingService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a training source by ID' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.trainingService.findOne(id, req.user.organizationId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a training source' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateTrainingSourceDto>,
    @Request() req,
  ) {
    return this.trainingService.update(id, updateDto, req.user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a training source' })
  async remove(@Param('id') id: string, @Request() req) {
    return this.trainingService.remove(id, req.user.organizationId);
  }
}
