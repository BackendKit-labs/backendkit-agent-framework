import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './entities/department.entity';
import { CreateDepartmentDto, UpdateDepartmentDto, QueryDepartmentDto } from './dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly repo: Repository<Department>,
  ) {}

  async findAll(query: QueryDepartmentDto) {
    const { page = 1, limit = 20, search } = query;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('dept');
    if (search) {
      qb.where('dept.name ILIKE :search OR dept.slug ILIKE :search', {
        search: `%${search}%`,
      });
    }

    const [data, total] = await qb
      .orderBy('dept.name', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const dept = this.repo.create(dto);
    dept.normalizeSlug();

    const existing = await this.repo.findOne({ where: { slug: dept.slug } });
    if (existing) {
      throw new ConflictException(`A department with slug "${dept.slug}" already exists`);
    }

    return this.repo.save(dept);
  }

  async findOne(id: string): Promise<Department> {
    const dept = await this.repo.findOne({ where: { id } });
    if (!dept) throw new NotFoundException(`Department "${id}" not found`);
    return dept;
  }

  async findBySlug(slug: string): Promise<Department> {
    const dept = await this.repo.findOne({ where: { slug } });
    if (!dept) throw new NotFoundException(`Department with slug "${slug}" not found`);
    return dept;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const dept = await this.findOne(id);

    if (dto.slug && dto.slug !== dept.slug) {
      const conflict = await this.repo.findOne({ where: { slug: dto.slug } });
      if (conflict) {
        throw new ConflictException(`A department with slug "${dto.slug}" already exists`);
      }
    }

    Object.assign(dept, dto);
    return this.repo.save(dept);
  }

  async remove(id: string): Promise<void> {
    const dept = await this.findOne(id);
    await this.repo.remove(dept);
  }
}
