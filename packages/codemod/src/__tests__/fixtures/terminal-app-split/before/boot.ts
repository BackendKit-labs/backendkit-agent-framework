import { createBaseEngine, discoverAgents, SkillManager, type FrameworkConfig, atomicWrite } from '@backendkit-labs/agent-core';
import { trustProject } from '@backendkit-labs/agent-core';

export const boot = [createBaseEngine, discoverAgents, SkillManager, atomicWrite, trustProject];
export type Cfg = FrameworkConfig;
