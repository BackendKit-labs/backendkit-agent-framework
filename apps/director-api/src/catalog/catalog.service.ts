import { Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogEntry } from './entities/catalog-entry.entity';
import { AgentCatalog } from './agent-catalog';
import { CreateCatalogEntryDto, UpdateCatalogEntryDto } from './dto';
import type { RuntimeKind } from '../runtime/runtime.spi';

/** Resolved template used by DirectorService at deploy time. */
export interface ResolvedTemplate {
  key: string;
  displayName: string;
  image: string;
  runtime: RuntimeKind;
  command?: string[];
  env?: Record<string, string>;
  defaultModel?: string;
  /** Env var names that MUST be present in dept secrets before deploy. */
  requiredSecrets: string[];
}

/** Default agent image when no template specifies one. */
function baseImage(): string {
  return process.env.DEFAULT_AGENT_IMAGE ?? 'agent-runtime:latest';
}

@Injectable()
export class CatalogService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(CatalogEntry)
    private readonly repo: Repository<CatalogEntry>,
    private readonly inMemory: AgentCatalog,
  ) {}

  // ── Bootstrap: seed in-memory entries to DB (idempotent) ─────────────────

  async onApplicationBootstrap(): Promise<void> {
    const seeds = this.inMemory.list();
    for (const s of seeds) {
      const exists = await this.repo.findOne({ where: { key: s.key } });
      if (!exists) {
        await this.repo.save(
          this.repo.create({
            key: s.key,
            displayName: s.displayName,
            description: s.description,
            category: 'custom',
            kind: 'agent',
            image: s.image ?? baseImage(),
            command: s.command ?? null,
            env: s.env ?? null,
            defaultModel: s.defaultModel ?? null,
            runtime: s.runtime ?? 'docker',
            requiredSecrets: null,
            isPublic: true,
          }),
        );
      }
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(category?: string): Promise<CatalogEntry[]> {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.category').addOrderBy('e.displayName');
    if (category) qb.where('e.category = :category', { category });
    return qb.getMany();
  }

  async findByKey(key: string): Promise<CatalogEntry> {
    const entry = await this.repo.findOne({ where: { key } });
    if (!entry) throw new NotFoundException(`CatalogEntry "${key}" not found`);
    return entry;
  }

  async findById(id: string): Promise<CatalogEntry> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException(`CatalogEntry "${id}" not found`);
    return entry;
  }

  async create(dto: CreateCatalogEntryDto): Promise<CatalogEntry> {
    const entry = this.repo.create({
      key: dto.key,
      displayName: dto.displayName,
      description: dto.description ?? null,
      category: dto.category ?? 'custom',
      kind: dto.kind ?? 'agent',
      image: dto.image,
      command: dto.command ?? null,
      env: dto.env ?? null,
      defaultModel: dto.defaultModel ?? null,
      runtime: dto.runtime ?? 'docker',
      requiredSecrets: dto.requiredSecrets ?? null,
      isPublic: dto.isPublic ?? true,
    });
    return this.repo.save(entry);
  }

  async update(id: string, dto: UpdateCatalogEntryDto): Promise<CatalogEntry> {
    const entry = await this.findById(id);
    Object.assign(entry, {
      ...(dto.key !== undefined && { key: dto.key }),
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.description !== undefined && { description: dto.description ?? null }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.image !== undefined && { image: dto.image }),
      ...(dto.command !== undefined && { command: dto.command ?? null }),
      ...(dto.env !== undefined && { env: dto.env ?? null }),
      ...(dto.defaultModel !== undefined && { defaultModel: dto.defaultModel ?? null }),
      ...(dto.runtime !== undefined && { runtime: dto.runtime }),
      ...(dto.requiredSecrets !== undefined && { requiredSecrets: dto.requiredSecrets ?? null }),
      ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
    });
    return this.repo.save(entry);
  }

  async remove(id: string): Promise<void> {
    const entry = await this.findById(id);
    await this.repo.remove(entry);
  }

  // ── Resolution (used by DirectorService) ─────────────────────────────────

  /** DB-first resolution; falls back to in-memory AgentCatalog for unknown keys. */
  async resolve(key: string): Promise<ResolvedTemplate> {
    const dbEntry = await this.repo.findOne({ where: { key } });
    if (dbEntry) {
      return {
        key: dbEntry.key,
        displayName: dbEntry.displayName,
        image: dbEntry.image,
        runtime: dbEntry.runtime as RuntimeKind,
        command: dbEntry.command ?? undefined,
        env: dbEntry.env ?? undefined,
        defaultModel: dbEntry.defaultModel ?? undefined,
        requiredSecrets: dbEntry.requiredSecrets ?? [],
      };
    }

    // Fallback: in-memory entry (no requiredSecrets constraint)
    const mem = this.inMemory.resolve(key);
    return {
      key: mem.key,
      displayName: mem.displayName,
      image: mem.image,
      runtime: mem.runtime,
      command: mem.command,
      env: mem.env,
      defaultModel: mem.defaultModel,
      requiredSecrets: [],
    };
  }
}
