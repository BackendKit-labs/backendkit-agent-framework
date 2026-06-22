import { Router } from 'express';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { readAgentConfig } from '../../storage/configStore.js';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
const AGENTS_DIR = resolve(DATA_DIR, 'agents');

export const dashboardRouter = Router();

dashboardRouter.get('/', (_req, res) => {
  const agents: string[] = [];
  if (existsSync(AGENTS_DIR)) {
    agents.push(...readdirSync(AGENTS_DIR).filter(f => {
      const stat = existsSync(resolve(AGENTS_DIR, f, 'current'));
      return stat;
    }));
  }

  const config = readAgentConfig();
  res.render('dashboard', {
    title: 'Config-Agent Dashboard',
    agents,
    config,
  });
});
