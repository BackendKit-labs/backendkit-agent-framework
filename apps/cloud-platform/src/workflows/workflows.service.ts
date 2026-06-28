import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from './entities/workflow.entity';
import { WorkflowStep } from './entities/workflow-step.entity';
import { WorkflowRun } from './entities/workflow-run.entity';
import {
  CreateWorkflowDto,
  UpdateWorkflowDto,
  QueryWorkflowDto,
  RunWorkflowDto,
} from './dto';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,

    @InjectRepository(WorkflowStep)
    private readonly stepRepo: Repository<WorkflowStep>,

    @InjectRepository(WorkflowRun)
    private readonly runRepo: Repository<WorkflowRun>,
  ) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(query: QueryWorkflowDto): Promise<Workflow[]> {
    const qb = this.workflowRepo.createQueryBuilder('wf')
      .leftJoinAndSelect('wf.steps', 'step')
      .orderBy('wf.createdAt', 'DESC')
      .addOrderBy('step.order', 'ASC');

    if (query.departmentId) qb.andWhere('wf.departmentId = :departmentId', query);
    if (query.status) qb.andWhere('wf.status = :status', query);

    return qb.getMany();
  }

  async findOne(id: string): Promise<Workflow> {
    const wf = await this.workflowRepo.findOne({
      where: { id },
      relations: ['steps'],
      order: { steps: { order: 'ASC' } } as any,
    });
    if (!wf) throw new NotFoundException(`Workflow "${id}" not found`);
    return wf;
  }

  async create(dto: CreateWorkflowDto): Promise<Workflow> {
    const wf = this.workflowRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? 'draft',
      trigger: dto.trigger ?? 'manual',
      departmentId: dto.departmentId ?? null,
    });

    const saved = await this.workflowRepo.save(wf);

    if (dto.steps?.length) {
      const steps = dto.steps.map((s) =>
        this.stepRepo.create({
          workflowId: saved.id,
          order: s.order,
          deployableId: s.deployableId ?? null,
          config: s.config ?? null,
        }),
      );
      await this.stepRepo.save(steps);
    }

    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateWorkflowDto): Promise<Workflow> {
    const wf = await this.findOne(id);

    if (dto.name !== undefined) wf.name = dto.name;
    if (dto.description !== undefined) wf.description = dto.description ?? null;
    if (dto.status !== undefined) wf.status = dto.status;
    if (dto.trigger !== undefined) wf.trigger = dto.trigger;
    if (dto.departmentId !== undefined) wf.departmentId = dto.departmentId ?? null;

    await this.workflowRepo.save(wf);

    // Replace steps if provided
    if (dto.steps !== undefined) {
      await this.stepRepo.delete({ workflowId: id });
      if (dto.steps.length) {
        const steps = dto.steps.map((s) =>
          this.stepRepo.create({
            workflowId: id,
            order: s.order,
            deployableId: s.deployableId ?? null,
            config: s.config ?? null,
          }),
        );
        await this.stepRepo.save(steps);
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const wf = await this.findOne(id);
    await this.workflowRepo.remove(wf);
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  async startRun(workflowId: string, dto: RunWorkflowDto): Promise<WorkflowRun> {
    const wf = await this.findOne(workflowId);

    const run = this.runRepo.create({
      workflowId: wf.id,
      status: 'pending',
      input: dto.input ?? null,
      startedAt: new Date(),
    });

    return this.runRepo.save(run);
  }

  async listRuns(workflowId: string): Promise<WorkflowRun[]> {
    await this.findOne(workflowId); // 404 guard
    return this.runRepo.find({
      where: { workflowId },
      order: { createdAt: 'DESC' },
    });
  }

  async getRun(runId: string): Promise<WorkflowRun> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`WorkflowRun "${runId}" not found`);
    return run;
  }
}
