import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Application } from './entities/application.entity';
import { UserRole } from './entities/user-role.entity';
import { Organization } from './entities/organization.entity';
import { JwtEd25519Service } from './common/crypto/jwt-ed25519.service';
import { SYSTEM_ORG_ID, SYSTEM_ORG_SLUG } from './common/tenancy/tenancy.constants';

const BOOTSTRAP_APP_NAME = 'backendkit-platform';
const BOOTSTRAP_ROLE_NAME = 'admin';
const TOKEN_DURATION_DAYS = 180;

const M2M_SERVICES = [
    { name: 'cloud-platform',  description: 'Cloud Platform — control plane de despliegue' },
    { name: 'director-agent',  description: 'Director Agent — orquestador de workflows' },
    { name: 'vault-manager',   description: 'Vault Manager — gestión de secretos' },
];

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapService.name);

    constructor(
        @InjectRepository(User)         private users:    Repository<User>,
        @InjectRepository(Role)         private roles:    Repository<Role>,
        @InjectRepository(Application)  private apps:     Repository<Application>,
        @InjectRepository(UserRole)     private userRoles: Repository<UserRole>,
        @InjectRepository(Organization) private orgs:     Repository<Organization>,
    ) {}

    async onApplicationBootstrap() {
        await this.bootstrapAdmin();
        await this.bootstrapM2mTokens();
    }

    // ── Admin user ─────────────────────────────────────────────────────────────

    private async bootstrapAdmin() {
        const email    = process.env.BOOTSTRAP_ADMIN_EMAIL;
        const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
        if (!email || !password) return;

        const existingUser = await this.users.findOne({ where: { email } });
        if (existingUser) return;

        this.logger.log(`Creando usuario admin inicial (${email})`);

        // Application de plataforma
        let app = await this.apps.findOne({ where: { name: BOOTSTRAP_APP_NAME } });
        if (!app) {
            app = this.apps.create({ name: BOOTSTRAP_APP_NAME, environment: 'production', createdBy: 'bootstrap' });
            app = await this.apps.save(app);
        }

        // Rol admin
        let role = await this.roles.findOne({ where: { name: BOOTSTRAP_ROLE_NAME, applicationId: app.id } });
        if (!role) {
            role = this.roles.create({
                name: BOOTSTRAP_ROLE_NAME,
                description: 'Administrador de plataforma',
                applicationId: app.id,
                type: 'system',
                weight: 100,
                createdBy: 'bootstrap',
            });
            role = await this.roles.save(role);
        }

        // Usuario
        const passwordHash = await bcrypt.hash(password, 12);
        const [firstName, ...rest] = email.split('@')[0].split('.');
        const user = this.users.create({
            email,
            username:    email,
            firstName:   firstName ?? 'Admin',
            lastName:    rest.join(' ') || 'Bootstrap',
            passwordHash,
            accountType: 'user',
            isActive:    true,
            createdBy:   'bootstrap',
        });
        const savedUser = await this.users.save(user);

        // UserRole
        await this.userRoles.save(this.userRoles.create({
            userId:        savedUser.id,
            roleId:        role.id,
            applicationId: app.id,
            createdBy:     'bootstrap',
        }));

        this.logger.log(`Admin creado — ${email} (rol: ${BOOTSTRAP_ROLE_NAME})`);
    }

    // ── M2M service tokens ─────────────────────────────────────────────────────

    private async bootstrapM2mTokens() {
        const privateKey = process.env.ED25519_PRIVATE_KEY;
        if (!privateKey) return;

        // System org (requerida para M2M apps de infraestructura)
        const orgExists = await this.orgs.findOne({ where: { id: SYSTEM_ORG_ID } as any });
        if (!orgExists) {
            await this.orgs.save(this.orgs.create({
                id:       SYSTEM_ORG_ID,
                name:     'System',
                slug:     SYSTEM_ORG_SLUG,
                isSystem: true,
                plan:     'enterprise',
            } as any));
        }

        const results: { name: string; appId: string; token: string }[] = [];

        for (const svc of M2M_SERVICES) {
            let m2mApp = await this.apps.findOne({ where: { name: svc.name, type: 'm2m_service' } as any });

            if (!m2mApp) {
                m2mApp = this.apps.create({
                    name:             svc.name,
                    description:      svc.description,
                    type:             'm2m_service' as any,
                    tokenDurationDays: TOKEN_DURATION_DAYS,
                    organizationId:   SYSTEM_ORG_ID,
                    createdBy:        'bootstrap',
                });
                m2mApp = await this.apps.save(m2mApp);
                this.logger.log(`M2M app creada: ${svc.name} (${m2mApp.id})`);
            }

            const token = JwtEd25519Service.signWithKey(
                privateKey,
                {
                    payload: {
                        sub:             m2mApp.id,
                        type:            'service',
                        applicationId:   m2mApp.id,
                        applicationName: svc.name,
                        accountType:     'service',
                        iss:             process.env.JWT_ISSUER ?? 'abac-service',
                        aud:             process.env.JWT_AUDIENCE ?? 'abac-clients',
                    },
                    expiresIn: TOKEN_DURATION_DAYS * 24 * 60 * 60,
                },
                { kid: process.env.ED25519_KID ?? 'abac-m2m-v1' },
            );

            results.push({ name: svc.name, appId: m2mApp.id, token });
        }

        // Imprimir tokens con formato visible en logs
        this.logger.log('');
        this.logger.log('╔══════════════════════════════════════════════════════════════╗');
        this.logger.log('║  TOKENS M2M GENERADOS — agregar al .env y reiniciar          ║');
        this.logger.log('╚══════════════════════════════════════════════════════════════╝');
        for (const r of results) {
            this.logger.log(`  [${r.name}]  APP_ID=${r.appId}`);
            this.logger.log(`  ABAC_M2M_TOKEN=${r.token}`);
            this.logger.log('');
        }
        this.logger.log('  Para cloud-platform copiar:');
        const cp = results.find(r => r.name === 'cloud-platform');
        if (cp) {
            this.logger.log(`  CLOUD_APP_ID=${cp.appId}`);
            this.logger.log(`  CLOUD_M2M_TOKEN=${cp.token}`);
        }
        this.logger.log('════════════════════════════════════════════════════════════════');
    }
}
