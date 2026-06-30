import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SignupService } from '../services/signup.service';
import { OrgSignupDto } from '../dtos/signup.dto';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationController {
    constructor(private readonly signupService: SignupService) {}

    /**
     * Registro self-service de una nueva organización (tenant signup).
     * Crea la org, el primer admin y materializa el rol 'admin' con todos
     * los permisos existentes. Devuelve un JWT listo para usar.
     * Endpoint público — no requiere autenticación.
     */
    @Post('signup')
    @HttpCode(201)
    @ApiOperation({ summary: 'Crear nueva organización + primer admin (tenant signup)' })
    signup(@Body() dto: OrgSignupDto) {
        return this.signupService.signup(dto);
    }
}
