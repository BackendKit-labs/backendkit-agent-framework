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

  async findAll(query: QueryDeployableDto) {
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

  async findOne(id: string): Promise<Deployable> {
    const d = await this.repo.findOne({
      where: { id },
      relations: ['department'],
    });
    if (!d) throw new NotFoundException(`Deployable "${id}" not found`);
    return d;
  }

  async update(id: string, dto: UpdateDeployableDto): Promise<Deployable> {
    const d = await this.findOne(id);
    Object.assign(d, dto);
    return this.repo.save(d);
  }

  async remove(id: string): Promise<void> {
    const d = await this.findOne(id);
    await this.repo.remove(d);
  }

  async findByDepartment(departmentId: string): Promise<Deployable[]> {
    return this.repo.find({
      where: { departmentId },
      order: { createdAt: 'DESC' },
    });
  }
}
