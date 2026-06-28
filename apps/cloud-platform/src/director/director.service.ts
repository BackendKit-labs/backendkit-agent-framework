import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deployable } from '../deployables/entities/deployable.entity';
import { RuntimeRegistry } from '../runtime/runtime.registry';
import type { RuntimeDaemonStatus } from '../runtime/runtime.spi';
import { CatalogService } from '../catalog/catalog.service';
import { SecretsService } from '../departments/secrets.service';
import { DeployAgentDto } from './dto/deploy-agent.dto';
import { ExecuteActionDto } from './dto/execute-action.dto';

@Injectable()
export class DirectorService {
  private readonly logger = new Logger(DirectorService.name);

  constructor(
    @InjectRepository(Deployable)
    private readonly deployableRepo: Repository<Deployable>,
    private readonly runtimes: RuntimeRegistry,
    private readonly catalog: CatalogService,
    private readonly secrets: SecretsService,
  ) {}

  getCatalog(category?: string) {
    return this.catalog.findAll(category);
  }

  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    uptime: number;
    runtimes: RuntimeDaemonStatus[];
  }> {
    const runtimes = await Promise.all(this.runtimes.all().map((a) => a.ping()));
    const reachable = runtimes.filter((r) => r.reachable === 'reachable').length;
    const available = runtimes.filter((r) => r.reachable !== 'coming_soon').length;
    const status = reachable > 0 ? 'healthy' : available > 0 ? 'down' : 'degraded';
    return { status, uptime: process.uptime(), runtimes };
  }

  async getMetrics() {
    const total = await this.deployableRepo.count();
    const running = await this.deployableRepo.count({ where: { status: 'running' } });
    const byKind = {
      agent: await this.deployableRepo.count({ where: { kind: 'agent' } }),
      app: await this.deployableRepo.count({ where: { kind: 'app' } }),
    };

    const statusCounts = await this.deployableRepo
      .createQueryBuilder('d')
      .select('d.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.status')
      .getRawMany();

    const byStatus = Object.fromEntries(
      statusCounts.map((r) => [r.status, parseInt(r.count, 10)]),
    );

    const deptCount = await this.deployableRepo
      .createQueryBuilder('d')
      .select('COUNT(DISTINCT d.departmentId)', 'count')
      .getRawOne()
      .then((r) => parseInt(r.count, 10) || 0);

    return {
      totalDeployables: total,
      activeDeployables: running,
      totalDepartments: deptCount,
      byKind,
      byStatus,
      uptime: process.uptime(),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  async getRuntimes() {
    return Promise.all(
      this.runtimes.all().map(async (a) => ({
        kind: a.kind,
        availability: a.availability,
        capabilities: a.capabilities(),
        daemon: await a.ping(),
      })),
    );
  }

  async getDeployedAgents() {
    const deployables = await this.deployableRepo.find({
      where: { status: 'running' },
      relations: ['department'],
    });
    return deployables.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      catalogKey: d.catalogKey,
      departmentId: d.departmentId,
      department: d.department?.name ?? null,
      runtime: d.runtime,
      handle: d.runtimeHandle,
      status: d.status,
      createdAt: d.createdAt,
    }));
  }

  async deployAgent(dto: DeployAgentDto): Promise<any> {
    const deployable = await this.findDeployable(dto.agentId);
    const adapter = this.runtimes.require(deployable.runtime);

    const template = await this.catalog.resolve(deployable.catalogKey ?? deployable.name);
    const image = deployable.image ?? template.image;
    const model = deployable.model ?? template.defaultModel;

    // Fetch department secrets — injected into container env so the deployable
    // can use CODEX_API_KEY, ANTHROPIC_API_KEY, etc. without hardcoding them.
    const deptSecrets = deployable.departmentId
      ? await this.secrets.getEnvMap(deployable.departmentId)
      : {};

    // Validate requiredSecrets before touching Docker — fail fast with clear message.
    if (template.requiredSecrets.length > 0) {
      const missing = template.requiredSecrets.filter((k) => !(k in deptSecrets));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Department is missing required secrets for "${template.key}": ${missing.join(', ')}. ` +
          `Configure them via POST /departments/:id/secrets before deploying.`,
        );
      }
    }

    try {
      deployable.status = 'starting';
      await this.deployableRepo.save(deployable);

      const handle = await adapter.deploy({
        agentId: deployable.id,
        name: deployable.name,
        image,
        command: template.command,
        env: {
          ...template.env,       // catalog defaults (lowest priority)
          ...deptSecrets,        // department secrets (override template)
          AGENT_ID: deployable.id,                           // structural vars always win
          AGENT_TYPE: deployable.catalogKey ?? deployable.kind,
          ...(model ? { MODEL: model } : {}),
        },
      });

      deployable.runtimeHandle = handle.id;
      deployable.status = 'running';
      await this.deployableRepo.save(deployable);

      return {
        id: deployable.id,
        name: deployable.name,
        kind: deployable.kind,
        status: 'running',
        runtime: deployable.runtime,
        handle: handle.id,
      };
    } catch (error) {
      this.logger.error(`Failed to deploy deployable ${deployable.id}`, error as Error);
      deployable.status = 'error';
      await this.deployableRepo.save(deployable);
      throw new BadRequestException('Failed to deploy');
    }
  }

  async stopAgent(id: string): Promise<any> {
    const deployable = await this.findDeployable(id);

    if (deployable.runtimeHandle) {
      try {
        await this.runtimes.require(deployable.runtime).stop(deployable.runtimeHandle);
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.error(`Failed to stop instance ${id}`, error as Error);
      }
    }

    deployable.status = 'stopped';
    deployable.runtimeHandle = null;
    await this.deployableRepo.save(deployable);
    return { id: deployable.id, name: deployable.name, status: 'stopped' };
  }

  async executeAgent(id: string, dto: ExecuteActionDto): Promise<any> {
    const deployable = await this.findDeployable(id);
    if (deployable.status !== 'running') {
      throw new BadRequestException('Deployable is not running');
    }
    if (!deployable.runtimeHandle) {
      throw new BadRequestException('Deployable has no running instance');
    }
    const result = await this.runtimes
      .require(deployable.runtime)
      .exec(deployable.runtimeHandle, dto.action);
    return { deployableId: id, result };
  }

  async getAgentLogs(id: string): Promise<any> {
    const deployable = await this.findDeployable(id);
    if (!deployable.runtimeHandle) {
      return { logs: '', message: 'No running instance for this deployable' };
    }
    const logs = await this.runtimes
      .require(deployable.runtime)
      .logs(deployable.runtimeHandle, { tail: 200 });
    return { logs };
  }

  async getStatus() {
    const total = await this.deployableRepo.count();
    const running = await this.deployableRepo.count({ where: { status: 'running' } });
    return { status: running > 0 ? 'running' : 'idle', deployables: total };
  }

  private async findDeployable(id: string): Promise<Deployable> {
    const d = await this.deployableRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException(`Deployable "${id}" not found`);
    return d;
  }
}
