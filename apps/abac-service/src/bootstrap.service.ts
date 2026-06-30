import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Application } from './entities/application.entity';
import { UserRole } from './entities/user-role.entity';

const BOOTSTRAP_APP_NAME = 'backendkit-platform';
const BOOTSTRAP_ROLE_NAME = 'admin';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapService.name);

    constructor(
        @InjectRepository(User)         private users:    Repository<User>,
        @InjectRepository(Role)         private roles:    Repository<Role>,
        @InjectRepository(Application)  private apps:     Repository<Application>,
        @InjectRepository(UserRole)     private userRoles: Repository<UserRole>,
    ) {}

    async onApplicationBootstrap() {
        const email    = process.env.BOOTSTRAP_ADMIN_EMAIL;
        const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

        if (!email || !password) return;

        const existingUser = await this.users.findOne({ where: { email } });
        if (existingUser) return;

        this.logger.log(`Bootstrap: creando usuario admin inicial (${email})`);

        // 1. Application
        let app = await this.apps.findOne({ where: { name: BOOTSTRAP_APP_NAME } });
        if (!app) {
            app = this.apps.create({ name: BOOTSTRAP_APP_NAME, environment: 'production', createdBy: 'bootstrap' });
            app = await this.apps.save(app);
        }

        // 2. Role
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

        // 3. User
        const passwordHash = await bcrypt.hash(password, 12);
        const [firstName, ...rest] = email.split('@')[0].split('.');
        const user = this.users.create({
            email,
            username:     email,
            firstName:    firstName ?? 'Admin',
            lastName:     rest.join(' ') || 'Bootstrap',
            passwordHash,
            accountType:  'user',
            isActive:     true,
            createdBy:    'bootstrap',
        });
        const savedUser = await this.users.save(user);

        // 4. UserRole
        const userRole = this.userRoles.create({
            userId:        savedUser.id,
            roleId:        role.id,
            applicationId: app.id,
            createdBy:     'bootstrap',
        });
        await this.userRoles.save(userRole);

        this.logger.log(`Bootstrap: usuario admin creado — ${email} (rol: ${BOOTSTRAP_ROLE_NAME})`);
    }
}
