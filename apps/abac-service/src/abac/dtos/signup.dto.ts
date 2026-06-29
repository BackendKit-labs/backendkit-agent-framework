import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrgSignupDto {
    @ApiProperty({ example: 'Acme Corp', description: 'Nombre de la organización' })
    @IsString()
    @IsNotEmpty()
    orgName!: string;

    @ApiPropertyOptional({
        example: 'acme-corp',
        description: 'Slug único de la org (a-z, 0-9, guiones). Auto-generado desde orgName si no se provee.',
    })
    @IsString()
    @IsOptional()
    @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo puede contener letras minúsculas, números y guiones' })
    orgSlug?: string;

    @ApiProperty({ example: 'admin@acme.com', description: 'Email del primer administrador' })
    @IsEmail()
    @IsNotEmpty()
    adminEmail!: string;

    @ApiProperty({ example: '••••••••', description: 'Contraseña (mínimo 8 caracteres)' })
    @IsString()
    @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
    adminPassword!: string;

    @ApiProperty({ example: 'Ana', description: 'Nombre del administrador' })
    @IsString()
    @IsNotEmpty()
    adminFirstName!: string;

    @ApiProperty({ example: 'García', description: 'Apellido del administrador' })
    @IsString()
    @IsNotEmpty()
    adminLastName!: string;
}
