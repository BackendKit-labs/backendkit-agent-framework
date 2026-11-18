import { z } from '@backendkit-labs/agent-core';
import { other } from './other';

export const args = z.object({
  toolArgs: z.record(z.string(), z.unknown()).default({}),
  labels: z.record(z.string(), z.string()),
  nested: z.record(z.string(), z.record(z.string(), z.number())),
});

// not zod: left alone
export const x = other.record(1);
