import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DirectorService } from './director.service';
import { Deployable } from '../deployables/entities/deployable.entity';
import { RuntimeRegistry } from '../runtime/runtime.registry';
import type { RuntimeAdapter } from '../runtime/runtime.spi';
import { CatalogService } from '../catalog/catalog.service';
import { SecretsService } from '../departments/secrets.service';

const baseAgent: Deployable = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Test Agent',
  description: null,
  kind: 'agent',
  status: 'pending',
  departmentId: null,
  department: null,
  catalogKey: null,
  image: null,
  runtime: 'docker',
  runtimeHandle: null,
  model: null,
  mcpPort: null,
  publicPort: null,
  publicUrl: null,
  framework: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeAdapter(): jest.Mocked<RuntimeAdapter> {
  return {
    kind: 'docker',
    availability: 'available',
    capabilities: jest.fn(() => []),
    ping: jest.fn().mockResolvedValue({
      kind: 'docker',
      registered: true,
      reachable: 'reachable',
      endpoint: null,
      checkedAt: 'now',
      error: null,
    }),
    deploy: jest.fn().mockResolvedValue({
      id: 'container-1',
      kind: 'docker',
      agentId: baseAgent.id,
      name: baseAgent.name,
      phase: 'running',
      createdAt: 'now',
    }),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    status: jest.fn().mockResolvedValue({ phase: 'running' }),
    logs: jest.fn().mockResolvedValue('log line'),
    exec: jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
    list: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<RuntimeAdapter>;
}

describe('DirectorService', () => {
  let service: DirectorService;
  let repository: jest.Mocked<Repository<Deployable>>;
  let registry: { require: jest.Mock; all: jest.Mock; get: jest.Mock; availableKinds: jest.Mock };
  let adapter: jest.Mocked<RuntimeAdapter>;

  beforeEach(async () => {
    adapter = makeAdapter();
    registry = {
      require: jest.fn(() => adapter),
      all: jest.fn(() => [adapter]),
      get: jest.fn(() => adapter),
      availableKinds: jest.fn(() => ['docker']),
    };

    const mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      save: jest.fn(async (a) => a),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ status: 'running', count: '3' }]),
        getRawOne: jest.fn().mockResolvedValue({ count: '2' }),
      })),
    };

    const catalog = {
      findAll: jest.fn(() => []),
      resolve: jest.fn(async () => ({
        key: 'backend',
        image: 'agent-runtime:latest',
        command: undefined,
        env: {},
        requiredSecrets: [],
        defaultModel: undefined,
      })),
    };
    const secrets = { getEnvMap: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DirectorService,
        { provide: getRepositoryToken(Deployable), useValue: mockRepository },
        { provide: RuntimeRegistry, useValue: registry },
        { provide: CatalogService, useValue: catalog },
        { provide: SecretsService, useValue: secrets },
      ],
    }).compile();

    service = module.get(DirectorService);
    repository = module.get(getRepositoryToken(Deployable));
  });

  it('is defined', () => expect(service).toBeDefined());

  describe('getStatus', () => {
    it('reports running when there are active agents', async () => {
      repository.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
      const result = await service.getStatus();
      expect(result).toEqual({ status: 'running', deployables: 3 });
    });
  });

  describe('getHealth', () => {
    it('is healthy when a runtime daemon is reachable', async () => {
      const result = await service.getHealth();
      expect(result.status).toBe('healthy');
      expect(result.runtimes).toHaveLength(1);
    });

    it('is down when registered runtimes are unreachable', async () => {
      adapter.ping.mockResolvedValueOnce({
        kind: 'docker',
        registered: true,
        reachable: 'unavailable',
        endpoint: null,
        checkedAt: 'now',
        error: 'no daemon',
      });
      const result = await service.getHealth();
      expect(result.status).toBe('down');
    });
  });

  describe('deployAgent', () => {
    it('deploys via the runtime adapter and persists the handle', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent });
      const result = await service.deployAgent({ agentId: baseAgent.id });

      expect(registry.require).toHaveBeenCalledWith('docker');
      // image resolved from the catalog template (agent has no explicit image)
      expect(adapter.deploy).toHaveBeenCalledWith(
        expect.objectContaining({ image: 'agent-runtime:latest' }),
      );
      expect(result).toMatchObject({ status: 'running', handle: 'container-1' });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', runtimeHandle: 'container-1' }),
      );
    });

    it('throws NotFound when the agent does not exist', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.deployAgent({ agentId: 'nope' })).rejects.toThrow(NotFoundException);
    });

    it('propagates 503 when the runtime is unavailable (no fake success)', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent });
      registry.require.mockImplementationOnce(() => {
        throw new ServiceUnavailableException('coming_soon');
      });
      await expect(service.deployAgent({ agentId: baseAgent.id })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(adapter.deploy).not.toHaveBeenCalled();
    });

    it('marks the agent as ERROR when deploy fails', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent });
      adapter.deploy.mockRejectedValueOnce(new Error('boom'));
      await expect(service.deployAgent({ agentId: baseAgent.id })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' }),
      );
    });
  });

  describe('stopAgent', () => {
    it('stops the running instance and marks the agent stopped', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, status: 'running', runtimeHandle: 'container-1' });
      const result = await service.stopAgent(baseAgent.id);
      expect(adapter.stop).toHaveBeenCalledWith('container-1');
      expect(result.status).toBe('stopped');
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'stopped' }),
      );
    });

    it('throws NotFound when the agent does not exist', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.stopAgent('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeAgent', () => {
    it('execs a command in the running instance', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, status: 'running', runtimeHandle: 'container-1' });
      const result = await service.executeAgent(baseAgent.id, { action: 'echo hi' });
      expect(adapter.exec).toHaveBeenCalledWith('container-1', 'echo hi');
      expect(result.result.exitCode).toBe(0);
    });

    it('rejects when the agent is not active', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, status: 'stopped' });
      await expect(service.executeAgent(baseAgent.id, { action: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when there is no running instance', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, status: 'running', runtimeHandle: null });
      await expect(service.executeAgent(baseAgent.id, { action: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getAgentLogs', () => {
    it('returns real logs from the adapter', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, runtimeHandle: 'container-1' });
      const result = await service.getAgentLogs(baseAgent.id);
      expect(adapter.logs).toHaveBeenCalledWith('container-1', { tail: 200 });
      expect(result.logs).toBe('log line');
    });

    it('returns a placeholder when no instance is running', async () => {
      repository.findOne.mockResolvedValue({ ...baseAgent, runtimeHandle: null });
      const result = await service.getAgentLogs(baseAgent.id);
      expect(result.logs).toBe('');
      expect(result.message).toContain('No running instance');
    });
  });

  describe('getMetrics', () => {
    it('aggregates counts', async () => {
      repository.count
        .mockResolvedValueOnce(5) // total
        .mockResolvedValueOnce(3) // running
        .mockResolvedValueOnce(4) // kind=agent
        .mockResolvedValueOnce(1); // kind=app
      const result = await service.getMetrics();
      expect(result.totalDeployables).toBe(5);
      expect(result.activeDeployables).toBe(3);
      expect(result.byKind).toEqual({ agent: 4, app: 1 });
      expect(result.byStatus).toEqual({ running: 3 });
      expect(result.totalDepartments).toBe(2);
    });
  });
});
