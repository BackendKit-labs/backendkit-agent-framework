import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { NotFoundException } from '@nestjs/common';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: jest.Mocked<Repository<Project>>;

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

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: getRepositoryToken(Project),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    repository = module.get(getRepositoryToken(Project)) as jest.Mocked<Repository<Project>>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new project', async () => {
      const dto: CreateProjectDto = {
        name: 'New Project',
        description: 'Description',
        root: '/projects/new',
      };

      repository.create.mockReturnValue(mockProject);
      repository.save.mockResolvedValue(mockProject);

      const result = await service.create(dto);

      expect(result).toEqual(mockProject);
      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalledWith(mockProject);
    });

    it('should create project with optional fields', async () => {
      const dto: CreateProjectDto = {
        name: 'New Project',
        root: '/projects/new',
        agents: [{ id: 'agent-1' }],
        policies: [{ id: 'policy-1' }],
        gates: [{ id: 'gate-1' }],
      };

      const projectWithArrays = { ...mockProject, agents: dto.agents, policies: dto.policies, gates: dto.gates };
      repository.create.mockReturnValue(projectWithArrays);
      repository.save.mockResolvedValue(projectWithArrays);

      const result = await service.create(dto);

      expect(result.agents).toEqual(dto.agents);
      expect(result.policies).toEqual(dto.policies);
      expect(result.gates).toEqual(dto.gates);
    });
  });

  describe('findAll', () => {
    it('should return paginated projects', async () => {
      const projects = [mockProject];
      repository.findAndCount.mockResolvedValue([projects, 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual(projects);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('should handle empty result', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('should apply pagination parameters', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 2, limit: 5 });

      expect(repository.findAndCount).toHaveBeenCalledWith({
        skip: 5,
        take: 5,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a project by id', async () => {
      repository.findOne.mockResolvedValue(mockProject);

      const result = await service.findOne(mockProject.id);

      expect(result).toEqual(mockProject);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: mockProject.id } });
    });

    it('should throw NotFoundException when project not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a project', async () => {
      const dto: UpdateProjectDto = { name: 'Updated Name' };
      const updatedProject = { ...mockProject, name: 'Updated Name' };

      repository.findOne.mockResolvedValue(mockProject);
      repository.save.mockResolvedValue(updatedProject);

      const result = await service.update(mockProject.id, dto);

      expect(result.name).toBe('Updated Name');
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException when updating non-existent project', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.update('nonexistent-id', { name: 'test' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove a project', async () => {
      repository.findOne.mockResolvedValue(mockProject);
      repository.remove.mockResolvedValue(mockProject);

      await service.remove(mockProject.id);

      expect(repository.remove).toHaveBeenCalledWith(mockProject);
    });

    it('should throw NotFoundException when removing non-existent project', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });
});