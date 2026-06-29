import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DeployablesService } from './deployables.service';
import { Deployable } from './entities/deployable.entity';

describe('DeployablesService — dept-scoping', () => {
  let service: DeployablesService;

  // QueryBuilder espía: registra los andWhere y devuelve resultados controlados.
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
    it('filtra por dept.slug cuando hay deptScope', async () => {
      await service.findAll({}, 'backend');
      const deptFilter = qbCalls.find((c) => c.clause === 'dept.slug = :deptScope');
      expect(deptFilter).toBeDefined();
      expect(deptFilter?.params).toEqual({ deptScope: 'backend' });
    });

    it('no filtra por dept cuando deptScope es null (M2M / sin dept)', async () => {
      await service.findAll({}, null);
      expect(qbCalls.find((c) => c.clause === 'dept.slug = :deptScope')).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('devuelve el deployable cuando su dept.slug coincide con el scope', async () => {
      const d = { id: 'x', department: { slug: 'backend' } };
      repo.findOne.mockResolvedValue(d);
      await expect(service.findOne('x', 'backend')).resolves.toBe(d);
    });

    it('lanza 404 cuando el dept.slug no coincide con el scope', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', department: { slug: 'legal' } });
      await expect(service.findOne('x', 'backend')).rejects.toThrow(NotFoundException);
    });

    it('sin scope (M2M) devuelve cualquier deployable', async () => {
      const d = { id: 'x', department: { slug: 'legal' } };
      repo.findOne.mockResolvedValue(d);
      await expect(service.findOne('x', null)).resolves.toBe(d);
    });

    it('lanza 404 cuando no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('x', 'backend')).rejects.toThrow(NotFoundException);
    });
  });
});
