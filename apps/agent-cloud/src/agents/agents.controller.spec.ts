import { Test, TestingModule } from '@nestjs/testing';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { QueryAgentDto } from './dto/query-agent.dto';
import { Agent, AgentStatus } from './entities/agent.entity';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: jest.Mocked<AgentsService>;

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

  const mockPaginatedResult = {
    data: [mockAgent],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  beforeEach(async () => {
    const mockService = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findByProject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get(AgentsService) as jest.Mocked<AgentsService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/agents', () => {
    it('should return paginated agents', async () => {
      const query: QueryAgentDto = { page: 1, limit: 10 };
      service.findAll.mockResolvedValue(mockPaginatedResult);

      const result = await controller.findAll(query);

      expect(result).toEqual(mockPaginatedResult);
      expect(service.findAll).toHaveBeenCalledWith(query);
    });

    it('should pass query parameters to service', async () => {
      const query: QueryAgentDto = {
        page: 2,
        limit: 5,
        search: 'test',
        type: 'backend',
        status: 'active',
      };
      service.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
      });

      await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
    });

    it('should handle empty result', async () => {
      const query: QueryAgentDto = { page: 1, limit: 10 };
      const emptyResult = {
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      };
      service.findAll.mockResolvedValue(emptyResult);

      const result = await controller.findAll(query);

      expect(result).toEqual(emptyResult);
    });
  });

  describe('POST /api/agents', () => {
    it('should create an agent', async () => {
      const dto: CreateAgentDto = {
        name: 'New Agent',
        type: 'backend',
        description: 'A new agent',
        config: { key: 'value' },
        projectId: '660e8400-e29b-41d4-a716-446655440001',
        model: 'gpt-4',
      };
      service.create.mockResolvedValue(mockAgent);

      const result = await controller.create(dto);

      expect(result).toEqual(mockAgent);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('should return an agent by id', async () => {
      service.findOne.mockResolvedValue(mockAgent);

      const result = await controller.findOne(mockAgent.id);

      expect(result).toEqual(mockAgent);
      expect(service.findOne).toHaveBeenCalledWith(mockAgent.id);
    });
  });

  describe('PATCH /api/agents/:id', () => {
    it('should update an agent', async () => {
      const dto: UpdateAgentDto = { name: 'Updated Agent' };
      const updatedAgent = { ...mockAgent, name: 'Updated Agent' };
      service.update.mockResolvedValue(updatedAgent);

      const result = await controller.update(mockAgent.id, dto);

      expect(result).toEqual(updatedAgent);
      expect(service.update).toHaveBeenCalledWith(mockAgent.id, dto);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('should delete an agent', async () => {
      service.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockAgent.id);

      expect(result).toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith(mockAgent.id);
    });
  });

  describe('GET /api/agents/project/:projectId', () => {
    it('should return agents by project', async () => {
      const projectId = '660e8400-e29b-41d4-a716-446655440001';
      service.findByProject.mockResolvedValue([mockAgent]);

      const result = await controller.findByProject(projectId);

      expect(result).toEqual([mockAgent]);
      expect(service.findByProject).toHaveBeenCalledWith(projectId);
    });
  });
});
export {};