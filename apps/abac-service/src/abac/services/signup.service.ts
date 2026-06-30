import { Injectable, ConflictException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import {
    Organization,
    User,
    Role,
    RolePermission,
    UserRole,
    UserApplication,
    Permission,
} from '../../entities';
import { LoggerService } from '../../observability';
import { OrgSignupDto } from '../dtos/signup.dto';

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);
}

@Injectable()
export class SignupService {
    constructor(
        @InjectRepository(Organization) private orgRepo: Repository<Organization>,
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(Role) private roleRepo: Repository<Role>,
        @InjectRepository(RolePermission) private rolePermRepo: Repository<RolePermission>,
        @InjectRepository(UserRole) private userRoleRepo: Repository<UserRole>,
        @InjectRepository(UserApplication) private userAppRepo: Repository<UserApplication>,
        @InjectRepository(Permission) private permRepo: Repository<Permission>,
        private dataSource: DataSource,
        private jwtService: JwtService,
        private logger: LoggerService,
    ) {}

    async signup(dto: OrgSignupDto) {
        const appId = process.env.ABAC_APP_ID;
        if (!appId) throw new InternalServerErrorException('ABAC_APP_ID no configurado en el servidor');

        const slug = dto.orgSlug || slugify(dto.orgName);
        if (!slug) throw new BadRequestException('No se pudo generar un slug válido desde el nombre de la org');

        // Pre-checks sin transacción (lecturas rápidas)
        const [slugTaken, emailTaken] = await Promise.all([
            this.orgRepo.findOne({ where: { slug }, select: ['id'] }),
            this.userRepo.findOne({ where: { email: dto.adminEmail }, select: ['id'] }),
        ]);
        if (slugTaken) throw new ConflictException(`El slug '${slug}' ya está en uso`);
        if (emailTaken) throw new ConflictException(`El email '${dto.adminEmail}' ya está registrado`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Crear organización
            const org = this.orgRepo.create({
                name: dto.orgName,
                slug,
                isSystem: false,
                plan: 'free',
                createdBy: 'signup',
            });
            const savedOrg = await queryRunner.manager.save(Organization, org);

            // 2. Crear usuario admin
            const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
            const user = this.userRepo.create({
                email: dto.adminEmail,
                firstName: dto.adminFirstName,
                lastName: dto.adminLastName,
                username: `${dto.adminFirstName} ${dto.adminLastName}`,
                passwordHash,
                accountType: 'user',
                organizationId: savedOrg.id,
                createdBy: 'signup',
            });
            const savedUser = await queryRunner.manager.save(User, user);

            // 3. Crear rol 'admin' para esta org
            const adminRole = this.roleRepo.create({
                name: 'admin',
                description: 'Administrador de la organización',
                applicationId: appId,
                organizationId: savedOrg.id,
                type: 'custom',
                weight: 100,
                createdBy: 'signup',
            });
            const savedRole = await queryRunner.manager.save(Role, adminRole);

            // 4. Asignar todos los permisos existentes al rol admin (full access dentro del tenant)
            const allPermissions = await this.permRepo.find({ where: { isActive: true } });
            if (allPermissions.length > 0) {
                const rolePerms = allPermissions.map((p) =>
                    this.rolePermRepo.create({
                        roleId: savedRole.id,
                        permissionId: p.id,
                        effect: 'allow',
                        createdBy: 'signup',
                    }),
                );
                await queryRunner.manager.save(RolePermission, rolePerms);
            }

            // 5. Asignar rol al usuario
            const userRole = this.userRoleRepo.create({
                userId: savedUser.id,
                roleId: savedRole.id,
                applicationId: appId,
                createdBy: 'signup',
            });
            await queryRunner.manager.save(UserRole, userRole);

            // 6. Vincular usuario a la aplicación
            const userApp = this.userAppRepo.create({
                userId: savedUser.id,
                applicationId: appId,
                membershipType: 'admin',
                createdBy: 'signup',
            });
            await queryRunner.manager.save(UserApplication, userApp);

            await queryRunner.commitTransaction();

            this.logger.log(`Org signup: ${savedOrg.slug} / admin: ${savedUser.email}`, 'SIGNUP', {
                orgId: savedOrg.id,
                userId: savedUser.id,
            });

            // 7. Emitir JWT (mismo shape que adminLogin)
            const permissionStrings = allPermissions.map((p) => `${p.resource}:${p.action}`);
            const token = this.jwtService.sign(
                {
                    sub: savedUser.id,
                    email: savedUser.email,
                    type: 'admin',
                    accountType: 'user',
                    org: savedOrg.id,
                    orgSlug: savedOrg.slug,
                    appId,
                    roles: ['admin'],
                    permissions: permissionStrings,
                },
                { expiresIn: '8h' },
            );

            return {
                accessToken: token,
                tokenType: 'Bearer',
                expiresIn: 28800,
                user: {
                    id: savedUser.id,
                    email: savedUser.email,
                    firstName: savedUser.firstName,
                    lastName: savedUser.lastName,
                    roles: ['admin'],
                },
                organization: {
                    id: savedOrg.id,
                    name: savedOrg.name,
                    slug: savedOrg.slug,
                    plan: savedOrg.plan,
                },
                permissions: permissionStrings,
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error en org signup', 'SIGNUP', (error as Error).stack, {
                orgName: dto.orgName,
                adminEmail: dto.adminEmail,
            });
            throw error;
        } finally {
            await queryRunner.release();
        }
    }
}
