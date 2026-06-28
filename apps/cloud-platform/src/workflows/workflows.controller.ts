import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import {
  CreateWorkflowDto,
  UpdateWorkflowDto,
  QueryWorkflowDto,
  RunWorkflowDto,
} from './dto';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';

@Controller('workflows')
@UseGuards(FlexAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  @Get()
  findAll(@Query() query: QueryWorkflowDto) {
    return this.workflowsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateWorkflowDto) {
    return this.workflowsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflowsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkflowDto) {
    return this.workflowsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.workflowsService.remove(id);
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  @Post(':id/run')
  @HttpCode(HttpStatus.CREATED)
  run(@Param('id') id: string, @Body() dto: RunWorkflowDto) {
    return this.workflowsService.startRun(id, dto);
  }

  @Get(':id/runs')
  listRuns(@Param('id') id: string) {
    return this.workflowsService.listRuns(id);
  }

  // NOTE: this route must stay BELOW `:id/runs` to avoid NestJS matching "runs" as an id
  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.workflowsService.getRun(runId);
  }
}
