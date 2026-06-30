import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Project } from './entities/project.entity';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: jest.Mocked<ProjectsService>;

  const mockProject: Project = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Project',
    description: 'A test project',
    root: '/projects/test',
    agents: [],
    policies: [],
    gates: [],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const mockPaginatedResult = {
    data: [mockProject],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
    service = module.get(ProjectsService) as jest.Mocked<ProjectsService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/projects', () => {
    it('should create a project', async () => {
      const dto: CreateProjectDto = {
        name: 'New Project',
        description: 'Description',
        root: '/projects/new',
      };

      service.create.mockResolvedValue(mockProject);

      const result = await controller.create(dto);

      expect(result).toEqual(mockProject);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('should create project with optional arrays', async () => {
      const dto: CreateProjectDto = {
        name: 'New Project',
        root: '/projects/new',
        agents: [{ id: 'a1' }],
        policies: [{ id: 'p1' }],
        gates: [{ id: 'g1' }],
      };

      const projectWithArrays = { ...mockProject, agents: dto.agents, policies: dto.policies, gates: dto.gates };
      service.create.mockResolvedValue(projectWithArrays);

      const result = await controller.create(dto);

      expect(result.agents).toEqual(dto.agents);
      expect(result.policies).toEqual(dto.policies);
      expect(result.gates).toEqual(dto.gates);
    });
  });

  describe('GET /api/projects', () => {
    it('should return paginated projects', async () => {
      const query: PaginationQueryDto = { page: 1, limit: 10 };
      service.findAll.mockResolvedValue(mockPaginatedResult);

      const result = await controller.findAll(query);

      expect(result).toEqual(mockPaginatedResult);
      expect(service.findAll).toHaveBeenCalledWith(query);
    });

    it('should pass query parameters to service', async () => {
      const query: PaginationQueryDto = { page: 2, limit: 5 };
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
      const query: PaginationQueryDto = { page: 1, limit: 10 };
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

  describe('GET /api/projects/:id', () => {
    it('should return a project by id', async () => {
      service.findOne.mockResolvedValue(mockProject);

      const result = await controller.findOne(mockProject.id);

      expect(result).toEqual(mockProject);
      expect(service.findOne).toHaveBeenCalledWith(mockProject.id);
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('should update a project', async () => {
      const dto: UpdateProjectDto = { name: 'Updated Name' };
      const updatedProject = { ...mockProject, name: 'Updated Name' };
      service.update.mockResolvedValue(updatedProject);

      const result = await controller.update(mockProject.id, dto);

      expect(result.name).toBe('Updated Name');
      expect(service.update).toHaveBeenCalledWith(mockProject.id, dto);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete a project', async () => {
      service.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockProject.id);

      expect(result).toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith(mockProject.id);
    });
  });
});