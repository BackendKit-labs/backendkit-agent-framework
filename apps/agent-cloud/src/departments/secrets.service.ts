import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Secret } from './entities/secret.entity';
import { SetSecretDto } from './dto/set-secret.dto';

@Injectable()
export class SecretsService {
  constructor(
    @InjectRepository(Secret)
    private readonly repo: Repository<Secret>,
  ) {}

  /** Lists keys (never values) for a department. */
  async listKeys(departmentId: string): Promise<Omit<Secret, 'value' | 'department'>[]> {
    const secrets = await this.repo.find({ where: { departmentId } });
    return secrets.map(({ value: _v, department: _d, ...rest }) => rest);
  }

  /** Upsert a secret — creates or updates the existing key for the department. */
  async set(departmentId: string, dto: SetSecretDto): Promise<{ id: string; key: string; departmentId: string }> {
    let secret = await this.repo.findOne({ where: { departmentId, key: dto.key } });

    if (secret) {
      secret.value = dto.value;
    } else {
      secret = this.repo.create({ departmentId, key: dto.key, value: dto.value });
    }

    const saved = await this.repo.save(secret);
    return { id: saved.id, key: saved.key, departmentId: saved.departmentId };
  }

  async remove(departmentId: string, key: string): Promise<void> {
    const secret = await this.repo.findOne({ where: { departmentId, key } });
    if (!secret) throw new NotFoundException(`Secret "${key}" not found in department`);
    await this.repo.remove(secret);
  }

  /** Returns all secrets as an env-var map — used by DirectorService at deploy time. */
  async getEnvMap(departmentId: string): Promise<Record<string, string>> {
    const secrets = await this.repo.find({ where: { departmentId } });
    return Object.fromEntries(secrets.map((s) => [s.key, s.value]));
  }
}
