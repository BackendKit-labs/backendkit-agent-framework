import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { SecretsService } from './secrets.service';
import { CreateDepartmentDto, UpdateDepartmentDto, QueryDepartmentDto, SetSecretDto } from './dto';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';

@Controller('departments')
@UseGuards(FlexAuthGuard)
export class DepartmentsController {
  constructor(
    private readonly departmentsService: DepartmentsService,
    private readonly secretsService: SecretsService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDepartmentDto) {
    return this.departmentsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.departmentsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.departmentsService.remove(id);
  }

  // ── Secrets (keys only — values never returned) ──────────────────────────

  @Get(':id/secrets')
  listSecrets(@Param('id') id: string) {
    return this.secretsService.listKeys(id);
  }

  @Post(':id/secrets')
  setSecret(@Param('id') id: string, @Body() dto: SetSecretDto) {
    return this.secretsService.set(id, dto);
  }

  @Delete(':id/secrets/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSecret(@Param('id') id: string, @Param('key') key: string) {
    return this.secretsService.remove(id, key);
  }
}
