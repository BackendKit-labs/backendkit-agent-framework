import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { RuntimeAdapter, RuntimeKind } from './runtime.spi';

/**
 * Routes the director to a concrete RuntimeAdapter by kind. Adapters register
 * themselves on module init; `require` enforces the anti-fake discipline by
 * refusing kinds that are missing or still `coming_soon`.
 */
@Injectable()
export class RuntimeRegistry {
  private readonly logger = new Logger(RuntimeRegistry.name);
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.kind, adapter);
    this.logger.log(`Registered runtime '${adapter.kind}' (${adapter.availability})`);
  }

  /** Returns a usable adapter or throws 503 when missing / coming_soon. */
  require(kind: RuntimeKind): RuntimeAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new ServiceUnavailableException(`Runtime '${kind}' is not registered`);
    }
    if (adapter.availability === 'coming_soon') {
      throw new ServiceUnavailableException(`Runtime '${kind}' is not available yet (coming_soon)`);
    }
    return adapter;
  }

  get(kind: RuntimeKind): RuntimeAdapter | undefined {
    return this.adapters.get(kind);
  }

  all(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  availableKinds(): RuntimeKind[] {
    return this.all()
      .filter((a) => a.availability === 'available')
      .map((a) => a.kind);
  }
}
