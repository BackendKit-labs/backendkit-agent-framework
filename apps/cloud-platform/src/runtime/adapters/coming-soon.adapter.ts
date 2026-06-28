import { ServiceUnavailableException } from '@nestjs/common';
import type {
  AgentSpec,
  ExecResult,
  RuntimeAdapter,
  RuntimeCapability,
  RuntimeDaemonStatus,
  RuntimeHandle,
  RuntimeKind,
  RuntimeStatus,
} from '../runtime.spi';

/**
 * Base for runtimes that are declared but not implemented yet. It never fakes
 * success: every lifecycle call throws an explicit 503 and ping() reports
 * `coming_soon`. Subclasses only set `kind` and `reason`.
 */
export abstract class ComingSoonAdapter implements RuntimeAdapter {
  readonly availability = 'coming_soon' as const;
  abstract readonly kind: RuntimeKind;
  protected abstract readonly reason: string;

  capabilities(): RuntimeCapability[] {
    return (['deploy', 'stop', 'remove', 'logs', 'exec'] as const).map((name) => ({
      name,
      status: 'coming_soon' as const,
      reason: this.reason,
    }));
  }

  async ping(): Promise<RuntimeDaemonStatus> {
    return {
      kind: this.kind,
      registered: true,
      reachable: 'coming_soon',
      endpoint: null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  private unavailable(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException(`Runtime '${this.kind}' no disponible: ${this.reason}`),
    );
  }

  deploy(_spec: AgentSpec): Promise<RuntimeHandle> {
    return this.unavailable();
  }
  stop(_handleId: string): Promise<void> {
    return this.unavailable();
  }
  remove(_handleId: string): Promise<void> {
    return this.unavailable();
  }
  status(_handleId: string): Promise<RuntimeStatus> {
    return this.unavailable();
  }
  logs(_handleId: string): Promise<string> {
    return this.unavailable();
  }
  exec(_handleId: string, _command: string): Promise<ExecResult> {
    return this.unavailable();
  }
  list(): Promise<RuntimeHandle[]> {
    return this.unavailable();
  }
}
