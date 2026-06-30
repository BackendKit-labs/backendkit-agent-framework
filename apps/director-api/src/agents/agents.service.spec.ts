import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentsService } from './agents.service';
import { Agent, AgentStatus } from './entities/agent.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { NotFoundException } from '@nestjs/common';

describe('AgentsService', () => {
  let service: AgentsService;
  let repository: jest.Mocked<Repository<Agent>>;

  const mockAgent: Agent = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Agent',
    description: 'A test agent',
    type: 'backend',
    status: AgentStatus.ACTIVE,
    config: { key: 'value' },
    projectId: '660e8400-e29b-41d4-a716-446655440001',
    model: 'gpt-4',
    runtime: 'docker',
    image: null,
    runtimeHandle: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const mockCreateAgentDto: CreateAgentDto = {
    name: 'Test Agent',
    description: 'A test agent',
    type: 'backend',
    status: AgentStatus.ACTIVE,
    config: { key: 'value' },
    projectId: '660e8400-e29b-41d4-a716-446655440001',
    model: 'gpt-4',
  };

  const mockUpdateAgentDto: UpdateAgentDto = {
    name: 'Updated Agent',
    description: 'Updated description',
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: getRepositoryToken(Agent),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    repository = module.get(getRepositoryToken(Agent)) as jest.Mocked<Repository<Agent>>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new agent', async () => {
      repository.create.mockReturnValue(mockAgent);
      repository.save.mockResolvedValue(mockAgent);

      const result = await service.create(mockCreateAgentDto);

      expect(result).toEqual(mockAgent);
      expect(repository.create).toHaveBeenCalledWith(mockCreateAgentDto);
      expect(repository.save).toHaveBeenCalledWith(mockAgent);
    });

    it('should create agent with minimal fields', async () => {
      const minimalDto: CreateAgentDto = {
        name: 'Minimal Agent',
        type: 'backend',
        status: AgentStatus.ACTIVE,
        projectId: '660e8400-e29b-41d4-a716-446655440001',
        model: 'gpt-4',
      };
      const minimalAgent = { ...mockAgent, name: 'Minimal Agent', description: undefined, config: undefined };
      repository.create.mockReturnValue(minimalAgent);
      repository.save.mockResolvedValue(minimalAgent);

      const result = await service.create(minimalDto);

      expect(result).toEqual(minimalAgent);
      expect(repository.create).toHaveBeenCalledWith(minimalDto);
    });
  });

  describe('findAll', () => {
    it('should return paginated agents with default pagination', async () => {
      repository.findAndCount.mockResolvedValue([[mockAgent], 1]);

      const result = await service.findAll({});

      expect(result).toEqual({
        data: [mockAgent],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 10,
        order: { createdAt: 'DESC' },
      });
    });

    it('should apply search filter', async () => {
      repository.findAndCount.mockResolvedValue([[mockAgent], 1]);

      await service.findAll({ search: 'test' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: expect.any(Object),
          }),
        }),
      );
    });

    it('should apply type filter', async () => {
      repository.findAndCount.mockResolvedValue([[mockAgent], 1]);

      await service.findAll({ type: 'backend' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'backend',
          }),
        }),
      );
    });

    it('should apply status filter', async () => {
      repository.findAndCount.mockResolvedValue([[mockAgent], 1]);

      await service.findAll({ status: 'active' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
          }),
        }),
      );
    });

    it('should apply custom pagination', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 2, limit: 5 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        }),
      );
    });

    it('should return empty result when no agents exist', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
    });
  });

  describe('findOne', () => {
    it('should return an agent by id', async () => {
      repository.findOne.mockResolvedValue(mockAgent);

      const result = await service.findOne(mockAgent.id);

      expect(result).toEqual(mockAgent);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: mockAgent.id } });
    });

    it('should throw NotFoundException when agent not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an existing agent', async () => {
      repository.findOne.mockResolvedValue(mockAgent);
      const updatedAgent = { ...mockAgent, ...mockUpdateAgentDto } as Agent;
      repository.save.mockResolvedValue(updatedAgent);

      const result = await service.update(mockAgent.id, mockUpdateAgentDto);

      expect(result).toEqual(updatedAgent);
      expect(repository.save).toHaveBeenCalledWith(updatedAgent);
    });

    it('should throw NotFoundException when updating non-existent agent', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.update('nonexistent-id', mockUpdateAgentDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove an existing agent', async () => {
      repository.findOne.mockResolvedValue(mockAgent);
      repository.remove.mockResolvedValue(mockAgent);

      await service.remove(mockAgent.id);

      expect(repository.remove).toHaveBeenCalledWith(mockAgent);
    });

    it('should throw NotFoundException when removing non-existent agent', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByProject', () => {
    it('should return agents by project id', async () => {
      repository.find.mockResolvedValue([mockAgent]);

      const result = await service.findByProject(mockAgent.projectId);

      expect(result).toEqual([mockAgent]);
      expect(repository.find).toHaveBeenCalledWith({
        where: { projectId: mockAgent.projectId },
        order: { createdAt: 'DESC' },
      });
    });

    it('should return empty array when project has no agents', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findByProject('nonexistent-project');

      expect(result).toEqual([]);
    });
  });
});