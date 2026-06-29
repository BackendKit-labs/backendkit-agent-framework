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
import { RequireTool, DeptScope } from '../common/decorators';

@Controller('deployables')
@UseGuards(FlexAuthGuard, AuthzGuard)
export class DeployablesController {
  constructor(private readonly deployablesService: DeployablesService) {}

  @Get()
  @RequireTool('list_deployables')
  findAll(
    @Query() query: QueryDeployableDto,
    @DeptScope() deptScope: string | null,
  ) {
    return this.deployablesService.findAll(query, deptScope);
  }

  @Post()
  @RequireTool('cloud_deploy')
  create(@Body() dto: CreateDeployableDto) {
    return this.deployablesService.create(dto);
  }

  @Get(':id')
  @RequireTool('get_deployable')
  findOne(@Param('id') id: string, @DeptScope() deptScope: string | null) {
    return this.deployablesService.findOne(id, deptScope);
  }

  @Patch(':id')
  @RequireTool('cloud_deploy')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeployableDto,
    @DeptScope() deptScope: string | null,
  ) {
    return this.deployablesService.update(id, dto, deptScope);
  }

  @Delete(':id')
  @RequireTool('cloud_stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @DeptScope() deptScope: string | null) {
    return this.deployablesService.remove(id, deptScope);
  }
}
