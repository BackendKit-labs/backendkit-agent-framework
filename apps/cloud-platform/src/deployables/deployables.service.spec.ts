import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DeployablesService } from './deployables.service';
import { Deployable } from './entities/deployable.entity';

describe('DeployablesService', () => {
  let service: DeployablesService;

  const qbCalls: Array<{ clause: string; params?: any }> = [];
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn((clause: string, params?: any) => {
      qbCalls.push({ clause, params });
      return qb;
    }),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };

  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(),
    remove: jest.fn(),
    save: jest.fn(),
    create: jest.fn((d) => d),
  };

  beforeEach(async () => {
    qbCalls.length = 0;
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeployablesService,
        { provide: getRepositoryToken(Deployable), useValue: repo },
      ],
    }).compile();
    service = module.get<DeployablesService>(DeployablesService);
  });

  describe('findAll', () => {
    it('devuelve resultados paginados sin filtros adicionales', async () => {
      const result = await service.findAll({});
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('no aplica filtro de dept (scope eliminado con HS256)', async () => {
      await service.findAll({});
      expect(qbCalls.find((c) => c.clause.includes('dept.slug'))).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('devuelve el deployable cuando existe', async () => {
      const d = { id: 'x', department: { slug: 'backend' } };
      repo.findOne.mockResolvedValue(d);
      await expect(service.findOne('x')).resolves.toBe(d);
    });

    it('lanza 404 cuando no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
    });
  });
});
