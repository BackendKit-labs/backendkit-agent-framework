import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deployable } from './entities/deployable.entity';
import { CreateDeployableDto, UpdateDeployableDto, QueryDeployableDto } from './dto';
import type { RuntimeKind } from '../runtime/runtime.spi';

@Injectable()
export class DeployablesService {
  constructor(
    @InjectRepository(Deployable)
    private readonly repo: Repository<Deployable>,
  ) {}

  async findAll(query: QueryDeployableDto, deptScope: string | null = null) {
    const { page = 1, limit = 20, search, kind, status, departmentId } = query;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.department', 'dept');

    if (search) {
      qb.andWhere('d.name ILIKE :search', { search: `%${search}%` });
    }
    if (kind) qb.andWhere('d.kind = :kind', { kind });
    if (status) qb.andWhere('d.status = :status', { status });
    if (departmentId) qb.andWhere('d.departmentId = :departmentId', { departmentId });
    // Scope por departamento (claim `dept` del JWT → Department.slug). Null = sin restricción.
    if (deptScope) qb.andWhere('dept.slug = :deptScope', { deptScope });

    const [data, total] = await qb
      .orderBy('d.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(dto: CreateDeployableDto): Promise<Deployable> {
    const deployable = this.repo.create({
      ...dto,
      runtime: (dto.runtime as RuntimeKind) ?? 'docker',
      status: 'pending',
    });
    return this.repo.save(deployable);
  }

  async findOne(id: string, deptScope: string | null = null): Promise<Deployable> {
    const d = await this.repo.findOne({
      where: { id },
      relations: ['department'],
    });
    // Fuera de scope se trata como inexistente (404) para no filtrar existencia entre depts.
    if (!d || (deptScope && d.department?.slug !== deptScope)) {
      throw new NotFoundException(`Deployable "${id}" not found`);
    }
    return d;
  }

  async update(
    id: string,
    dto: UpdateDeployableDto,
    deptScope: string | null = null,
  ): Promise<Deployable> {
    const d = await this.findOne(id, deptScope);
    Object.assign(d, dto);
    return this.repo.save(d);
  }

  async remove(id: string, deptScope: string | null = null): Promise<void> {
    const d = await this.findOne(id, deptScope);
    await this.repo.remove(d);
  }

  async findByDepartment(departmentId: string): Promise<Deployable[]> {
    return this.repo.find({
      where: { departmentId },
      order: { createdAt: 'DESC' },
    });
  }
}
