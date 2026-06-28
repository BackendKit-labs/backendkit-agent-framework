import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentStatus } from './entities/agent.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { QueryAgentDto } from './dto/query-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
  ) {}

  async findAll(query: QueryAgentDto) {
    const { page = 1, limit = 10, search, type, status } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.agentRepository.createQueryBuilder('agent');

    if (search) {
      queryBuilder.andWhere('agent.name ILIKE :search', { search: `%${search}%` });
    }

    if (type) {
      queryBuilder.andWhere('agent.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('agent.status = :status', { status });
    }

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .orderBy('agent.createdAt', 'DESC')
      .getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(createAgentDto: CreateAgentDto) {
    const agent = this.agentRepository.create({
      ...createAgentDto,
      status: (createAgentDto.status as AgentStatus) || AgentStatus.ACTIVE,
      runtime: createAgentDto.runtime as Agent['runtime'],
    });
    return this.agentRepository.save(agent);
  }

  async findOne(id: string) {
    const agent = await this.agentRepository.findOne({ where: { id } });
    if (!agent) {
      throw new NotFoundException(`Agent with ID "${id}" not found`);
    }
    return agent;
  }

  async update(id: string, updateAgentDto: UpdateAgentDto) {
    const agent = await this.findOne(id);
    Object.assign(agent, updateAgentDto);
    return this.agentRepository.save(agent);
  }

  async remove(id: string) {
    const agent = await this.findOne(id);
    return this.agentRepository.remove(agent);
  }

  async findByProject(projectId: string) {
    return this.agentRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }
}