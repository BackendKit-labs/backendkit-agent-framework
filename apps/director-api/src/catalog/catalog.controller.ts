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
import { CatalogService } from './catalog.service';
import { CreateCatalogEntryDto, UpdateCatalogEntryDto } from './dto';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';

@Controller('catalog')
@UseGuards(FlexAuthGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  findAll(@Query('category') category?: string) {
    return this.catalogService.findAll(category);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateCatalogEntryDto) {
    return this.catalogService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCatalogEntryDto) {
    return this.catalogService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.catalogService.remove(id);
  }
}
