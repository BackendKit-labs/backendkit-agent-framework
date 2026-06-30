import { IsString, IsOptional, IsObject, IsArray, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
    @ApiPropertyOptional({ example: 'Alice Smith' })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiPropertyOptional({ example: '+1234567890' })
    @IsString()
    @IsOptional()
    phone?: string;

    @ApiPropertyOptional({ type: Object })
    @IsObject()
    @IsOptional()
    profile?: Record<string, any>;

    @ApiPropertyOptional({ example: null, description: 'Enviar null para desvincular de Azure AD' })
    @IsString()
    @IsOptional()
    @Transform(({ value }) => value ?? null)
    entraId?: string | null;

    @ApiPropertyOptional({ example: 'sales', description: 'Department del usuario — define el resource ceiling MCP' })
    @IsString()
    @IsOptional()
    @MaxLength(100)
    department?: string | null;

    @ApiPropertyOptional({ type: [String], example: ['hubspot://contacts/*'], description: 'Override personal de MCP Resource URI patterns (subconjunto del ceiling del department)' })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    vaultResources?: string[] | null;
}
