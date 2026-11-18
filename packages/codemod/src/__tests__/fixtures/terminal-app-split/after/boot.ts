import { createBaseEngine, atomicWrite } from '@backendkit-labs/agent-core';
import { discoverAgents, SkillManager, type FrameworkConfig, trustProject } from '@backendkit-labs/agent-coding/cli';

export const boot = [createBaseEngine, discoverAgents, SkillManager, atomicWrite, trustProject];
export type Cfg = FrameworkConfig;
