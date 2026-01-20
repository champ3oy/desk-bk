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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MacrosService } from './macros.service';
import { CreateMacroDto } from './dto/create-macro.dto';
import { UpdateMacroDto } from './dto/update-macro.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Macro } from './entities/macro.entity';

@ApiTags('macros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('macros')
export class MacrosController {
  constructor(private readonly macrosService: MacrosService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new macro' })
  @ApiResponse({
    status: 201,
    description: 'The macro has been successfully created.',
    type: Macro,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or shortcut already exists.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  create(@Body() createMacroDto: CreateMacroDto, @Request() req) {
    return this.macrosService.create(
      createMacroDto,
      req.user.userId,
      req.user.organizationId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all macros accessible to the user' })
  @ApiResponse({
    status: 200,
    description: 'Return all accessible macros.',
    type: [Macro],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findAll(@Request() req) {
    return this.macrosService.findAll(
      req.user.userId,
      req.user.organizationId,
      req.user.role,
      req.user.teams,
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Search for a macro by shortcut' })
  @ApiQuery({
    name: 'shortcut',
    required: true,
    description: 'The shortcut to search for (e.g., /welcome)',
  })
  @ApiResponse({
    status: 200,
    description: 'Return the macro matching the shortcut.',
    type: Macro,
  })
  @ApiResponse({ status: 404, description: 'Macro not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  searchByShortcut(@Query('shortcut') shortcut: string, @Request() req) {
    return this.macrosService.searchByShortcut(
      shortcut,
      req.user.userId,
      req.user.organizationId,
      req.user.role,
      req.user.teams,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a macro by ID' })
  @ApiParam({ name: 'id', description: 'Macro ID' })
  @ApiResponse({
    status: 200,
    description: 'Return the macro.',
    type: Macro,
  })
  @ApiResponse({ status: 404, description: 'Macro not found.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - No access to this macro.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.macrosService.findOne(
      id,
      req.user.userId,
      req.user.organizationId,
      req.user.role,
      req.user.teams,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a macro' })
  @ApiParam({ name: 'id', description: 'Macro ID' })
  @ApiResponse({
    status: 200,
    description: 'The macro has been successfully updated.',
    type: Macro,
  })
  @ApiResponse({ status: 404, description: 'Macro not found.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - No permission to edit this macro.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation failed or shortcut already exists.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  update(
    @Param('id') id: string,
    @Body() updateMacroDto: UpdateMacroDto,
    @Request() req,
  ) {
    return this.macrosService.update(
      id,
      updateMacroDto,
      req.user.userId,
      req.user.organizationId,
      req.user.role,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a macro (soft delete)' })
  @ApiParam({ name: 'id', description: 'Macro ID' })
  @ApiResponse({
    status: 200,
    description: 'The macro has been successfully deleted.',
  })
  @ApiResponse({ status: 404, description: 'Macro not found.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - No permission to delete this macro.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  remove(@Param('id') id: string, @Request() req) {
    return this.macrosService.remove(
      id,
      req.user.userId,
      req.user.organizationId,
      req.user.role,
    );
  }
}
