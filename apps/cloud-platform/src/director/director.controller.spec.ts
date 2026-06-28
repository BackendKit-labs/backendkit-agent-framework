import { DirectorController } from './director.controller';
import { DirectorService } from './director.service';

describe('DirectorController', () => {
  let controller: DirectorController;
  let service: jest.Mocked<Pick<
    DirectorService,
    | 'getStatus'
    | 'getHealth'
    | 'getRuntimes'
    | 'getCatalog'
    | 'getDeployedAgents'
    | 'deployAgent'
    | 'stopAgent'
    | 'executeAgent'
    | 'getAgentLogs'
    | 'getMetrics'
  >>;

  beforeEach(() => {
    service = {
      getStatus: jest.fn().mockResolvedValue({ status: 'idle', agents: 0 }),
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy', uptime: 1, version: '1.0.0', runtimes: [] }),
      getRuntimes: jest.fn().mockResolvedValue([]),
      getCatalog: jest.fn().mockReturnValue([]),
      getDeployedAgents: jest.fn().mockResolvedValue([]),
      deployAgent: jest.fn().mockResolvedValue({ id: 'a', status: 'running', handle: 'c1' }),
      stopAgent: jest.fn().mockResolvedValue({ id: 'a', status: 'stopped' }),
      executeAgent: jest.fn().mockResolvedValue({ agentId: 'a', result: {} }),
      getAgentLogs: jest.fn().mockResolvedValue({ logs: '' }),
      getMetrics: jest.fn().mockResolvedValue({ totalAgents: 0, activeAgents: 0, totalProjects: 0, uptime: 1, memoryUsage: 1, cpuUsage: 1 }),
    };
    controller = new DirectorController(service as unknown as DirectorService);
  });

  it('delegates getStatus / getHealth / getMetrics', async () => {
    await controller.getStatus();
    await controller.getHealth();
    await controller.getMetrics();
    expect(service.getStatus).toHaveBeenCalled();
    expect(service.getHealth).toHaveBeenCalled();
    expect(service.getMetrics).toHaveBeenCalled();
  });

  it('getRuntimes delegates to the service', async () => {
    await controller.getRuntimes();
    expect(service.getRuntimes).toHaveBeenCalled();
  });

  it('getCatalog delegates to the service', async () => {
    await controller.getCatalog();
    expect(service.getCatalog).toHaveBeenCalled();
  });

  it('getAgents delegates to getDeployedAgents', async () => {
    await controller.getAgents();
    expect(service.getDeployedAgents).toHaveBeenCalled();
  });

  it('deploy delegates to deployAgent with the dto', async () => {
    await controller.deploy({ agentId: 'a1' });
    expect(service.deployAgent).toHaveBeenCalledWith({ agentId: 'a1' });
  });

  it('stop delegates to stopAgent with the id', async () => {
    await controller.stop('a1');
    expect(service.stopAgent).toHaveBeenCalledWith('a1');
  });

  it('execute delegates to executeAgent with id + dto', async () => {
    await controller.execute('a1', { action: 'run' });
    expect(service.executeAgent).toHaveBeenCalledWith('a1', { action: 'run' });
  });

  it('getLogs delegates to getAgentLogs with the id', async () => {
    await controller.getLogs('a1');
    expect(service.getAgentLogs).toHaveBeenCalledWith('a1');
  });
});
