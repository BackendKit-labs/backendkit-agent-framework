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
import { DeployablesService } from './deployables.service';
import { CreateDeployableDto, UpdateDeployableDto, QueryDeployableDto } from './dto';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';
import { AuthzGuard } from '../auth/guards/authz.guard';
import { RequirePermission, DeptScope } from '../common/decorators';

@Controller('deployables')
@UseGuards(FlexAuthGuard, AuthzGuard)
export class DeployablesController {
  constructor(private readonly deployablesService: DeployablesService) {}

  @Get()
  @RequirePermission('deployable:list')
  findAll(
    @Query() query: QueryDeployableDto,
    @DeptScope() deptScope: string | null,
  ) {
    return this.deployablesService.findAll(query, deptScope);
  }

  @Post()
  @RequirePermission('deployable:deploy')
  create(@Body() dto: CreateDeployableDto) {
    return this.deployablesService.create(dto);
  }

  @Get(':id')
  @RequirePermission('deployable:read')
  findOne(@Param('id') id: string, @DeptScope() deptScope: string | null) {
    return this.deployablesService.findOne(id, deptScope);
  }

  @Patch(':id')
  @RequirePermission('deployable:deploy')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeployableDto,
    @DeptScope() deptScope: string | null,
  ) {
    return this.deployablesService.update(id, dto, deptScope);
  }

  @Delete(':id')
  @RequirePermission('deployable:stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @DeptScope() deptScope: string | null) {
    return this.deployablesService.remove(id, deptScope);
  }
}
