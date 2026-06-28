import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deployable, DeployableStatus } from '../deployables/entities/deployable.entity';
import { RuntimeRegistry } from './runtime.registry';
import type { RuntimeHandle, RuntimePhase } from './runtime.spi';

/**
 * On boot, reconcile Deployable DB state against what each runtime actually reports.
 * Containers are discovered by the agent-cloud.* labels set at deploy time.
 *  - live instance  → sync status + handle from real runtime phase
 *  - DB says running, no instance found → mark stopped + clear handle
 */
@Injectable()
export class RuntimeReconciler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RuntimeReconciler.name);

  constructor(
    @InjectRepository(Deployable)
    private readonly deployables: Repository<Deployable>,
    private readonly runtimes: RuntimeRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const adapter of this.runtimes.all()) {
      if (adapter.availability !== 'available') continue;

      let handles: RuntimeHandle[];
      try {
        handles = await adapter.list();
      } catch (err) {
        this.logger.warn(`Reconcile skipped for '${adapter.kind}': ${(err as Error).message}`);
        continue;
      }

      const byId = new Map(handles.map((h) => [h.id, h]));
      const deployables = await this.deployables.find({ where: { runtime: adapter.kind } });
      let reconciled = 0;

      for (const d of deployables) {
        const handle = d.runtimeHandle ? byId.get(d.runtimeHandle) : undefined;

        if (handle) {
          const status = phaseToStatus(handle.phase);
          if (d.status !== status) {
            d.status = status;
            await this.deployables.save(d);
            reconciled++;
          }
        } else if (d.runtimeHandle || d.status === 'running' || d.status === 'starting') {
          d.status = 'stopped';
          d.runtimeHandle = null;
          await this.deployables.save(d);
          reconciled++;
        }
      }

      this.logger.log(
        `Reconciled '${adapter.kind}': ${handles.length} instance(s), ${reconciled} deployable(s) updated`,
      );
    }
  }
}

function phaseToStatus(phase: RuntimePhase): DeployableStatus {
  switch (phase) {
    case 'running':
      return 'running';
    case 'pending':
      return 'starting';
    case 'failed':
      return 'error';
    default:
      return 'stopped';
  }
}
