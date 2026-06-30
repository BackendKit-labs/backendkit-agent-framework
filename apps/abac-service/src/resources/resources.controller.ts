import {
    Controller, Get, Post, Delete, Body, Param, Query,
    UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ResourcesService } from './resources.service';
import { JwtAuthGuard } from '../abac/guards/jwt-auth.guard';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

class AddDepartmentResourceDto {
    @IsString() @IsNotEmpty() @MaxLength(100)  department!: string;
    @IsString() @IsNotEmpty() @MaxLength(500)  uriPattern!: string;
    @IsString() @IsOptional() @MaxLength(255)  description?: string;
}

@Controller('resources')
export class ResourcesController {
    constructor(private readonly resourcesService: ResourcesService) {}

    /**
     * Devuelve los URI patterns de MCP Resources permitidos para el usuario
     * autenticado. El mcp-server llama a este endpoint para filtrar resources/list
     * y validar resources/read.
     *
     * GET /resources/allowed
     * Authorization: Bearer <jwt>
     */
    @Get('allowed')
    @UseGuards(JwtAuthGuard)
    async getAllowed(@Request() req: { user: { sub: string } }): Promise<{ patterns: string[] }> {
        const patterns = await this.resourcesService.getAllowedPatterns(req.user.sub);
        return { patterns };
    }

    /**
     * Validar si un URI específico está permitido para el usuario.
     * Útil para el middleware de resources/read en mcp-server.
     *
     * GET /resources/check?uri=jira://sprint/active
     */
    @Get('check')
    @UseGuards(JwtAuthGuard)
    async checkUri(
        @Request() req: { user: { sub: string } },
        @Query('uri') uri: string,
    ): Promise<{ allowed: boolean; uri: string }> {
        const allowed = await this.resourcesService.isAllowed(req.user.sub, uri);
        return { allowed, uri };
    }

    /**
     * Lista el ceiling de resources por department.
     * Sin filtro devuelve todos los departments.
     *
     * GET /resources/department?department=sales
     */
    @Get('department')
    @UseGuards(JwtAuthGuard)
    async listByDepartment(@Query('department') department?: string) {
        return this.resourcesService.listDepartmentResources(department);
    }

    /**
     * Agrega un URI pattern al ceiling de un department (admin).
     *
     * POST /resources/department
     */
    @Post('department')
    @UseGuards(JwtAuthGuard)
    async addDepartmentResource(@Body() dto: AddDepartmentResourceDto) {
        return this.resourcesService.addDepartmentResource(
            dto.department,
            dto.uriPattern,
            dto.description,
        );
    }

    /**
     * Desactiva un URI pattern del ceiling (soft delete).
     *
     * DELETE /resources/department/:id
     */
    @Delete('department/:id')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    async removeDepartmentResource(@Param('id') id: string): Promise<void> {
        return this.resourcesService.removeDepartmentResource(id);
    }
}
