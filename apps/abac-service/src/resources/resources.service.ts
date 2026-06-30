import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentResource } from '../entities/department-resource.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class ResourcesService {
    constructor(
        @InjectRepository(DepartmentResource)
        private readonly deptResourceRepo: Repository<DepartmentResource>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
    ) {}

    /**
     * Devuelve los URI patterns efectivos para un usuario.
     *
     * Lógica de dos capas:
     *  1. Si el usuario tiene vaultResources explícito → usa ese (override personal)
     *  2. Si no → carga el department ceiling de department_resources
     *
     * En ambos casos el resultado nunca excede el department ceiling.
     */
    async getAllowedPatterns(userId: string): Promise<string[]> {
        const user = await this.userRepo.findOne({
            where: { id: userId, isActive: true },
            select: ['id', 'department', 'vaultResources'],
        });

        if (!user) return [];

        const department = user.department ?? null;

        // Si el usuario tiene vault personal → intersección con ceiling
        if (user.vaultResources && user.vaultResources.length > 0) {
            if (!department) return user.vaultResources;
            const ceiling = await this.getDepartmentCeiling(department);
            return intersect(user.vaultResources, ceiling);
        }

        // Sin vault personal → hereda el ceiling completo del department
        if (!department) return [];
        return this.getDepartmentCeiling(department);
    }

    async getDepartmentCeiling(department: string): Promise<string[]> {
        const rows = await this.deptResourceRepo.find({
            where: { department, isActive: true },
            select: ['uriPattern'],
        });
        return rows.map(r => r.uriPattern);
    }

    /** Valida si un URI concreto está permitido para el usuario. */
    async isAllowed(userId: string, uri: string): Promise<boolean> {
        const patterns = await this.getAllowedPatterns(userId);
        return patterns.some(p => matchesPattern(p, uri));
    }

    /** CRUD de resource ceilings para admin */
    async addDepartmentResource(department: string, uriPattern: string, description?: string): Promise<DepartmentResource> {
        const entity = this.deptResourceRepo.create({ department, uriPattern, description });
        return this.deptResourceRepo.save(entity);
    }

    async removeDepartmentResource(id: string): Promise<void> {
        await this.deptResourceRepo.update(id, { isActive: false });
    }

    async listDepartmentResources(department?: string): Promise<DepartmentResource[]> {
        const where = department ? { department, isActive: true } : { isActive: true };
        return this.deptResourceRepo.find({ where, order: { department: 'ASC', uriPattern: 'ASC' } });
    }
}

/** Glob-style match: supports * (single segment) and ** (any depth) */
function matchesPattern(pattern: string, uri: string): boolean {
    const re = new RegExp(
        '^' +
        pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars except * and ?
            .replace(/\*\*/g, '.+')                   // ** → match anything
            .replace(/\*/g, '[^/]+')                  // * → match within one segment
        + '$',
    );
    return re.test(uri);
}

/** Returns elements of `a` that match at least one pattern in `ceiling`. */
function intersect(a: string[], ceiling: string[]): string[] {
    return a.filter(pattern => ceiling.some(c => c === pattern || matchesPattern(c, pattern)));
}
