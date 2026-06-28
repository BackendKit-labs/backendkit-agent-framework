import { Injectable } from '@nestjs/common';
import { ComingSoonAdapter } from './coming-soon.adapter';

/**
 * Local-process runtime — planned. Future home for wrapping the agent-framework
 * MCPClientManager so process-agents and container-agents share one control plane.
 */
@Injectable()
export class ProcessRuntimeAdapter extends ComingSoonAdapter {
  readonly kind = 'process' as const;
  protected readonly reason = 'Adapter de proceso local (futuro: MCPClientManager)';
}
