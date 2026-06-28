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

@Controller('deployables')
@UseGuards(FlexAuthGuard)
export class DeployablesController {
  constructor(private readonly deployablesService: DeployablesService) {}

  @Get()
  findAll(@Query() query: QueryDeployableDto) {
    return this.deployablesService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateDeployableDto) {
    return this.deployablesService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deployablesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeployableDto) {
    return this.deployablesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.deployablesService.remove(id);
  }
}
