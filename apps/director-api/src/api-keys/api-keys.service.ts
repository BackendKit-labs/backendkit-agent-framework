import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateKey(): { plainText: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const plainText = `bkc_${raw}`;
  return { plainText, hash: sha256(plainText) };
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
  ) {}

  async create(dto: CreateApiKeyDto): Promise<{ id: string; name: string; key: string; createdAt: Date }> {
    const { plainText, hash } = generateKey();

    const apiKey = this.repo.create({
      name: dto.name,
      keyHash: hash,
      scopes: dto.scopes ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    const saved = await this.repo.save(apiKey);
    // key is returned only here — never again
    return { id: saved.id, name: saved.name, key: plainText, createdAt: saved.createdAt };
  }

  async findAll(): Promise<Omit<ApiKey, 'keyHash'>[]> {
    const keys = await this.repo.find({ order: { createdAt: 'DESC' } });
    return keys.map(({ keyHash: _h, ...rest }) => rest);
  }

  async revoke(id: string): Promise<void> {
    const key = await this.repo.findOne({ where: { id } });
    if (!key) throw new NotFoundException(`ApiKey "${id}" not found`);
    key.active = false;
    await this.repo.save(key);
  }

  /** Validates a plain-text key. Returns the ApiKey entity or null. */
  async validate(plainText: string): Promise<ApiKey | null> {
    if (!plainText?.startsWith('bkc_')) return null;

    const hash = sha256(plainText);
    const key = await this.repo.findOne({ where: { keyHash: hash, active: true } });
    if (!key) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;

    // Fire-and-forget lastUsedAt update — never blocks the request
    this.repo.update(key.id, { lastUsedAt: new Date() }).catch(() => {});
    return key;
  }
}
