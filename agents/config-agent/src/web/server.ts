import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readAgentConfig } from '../storage/configStore.js';
import { dashboardRouter } from './routes/dashboard.js';
import { configRouter }    from './routes/config.js';
import { historyRouter }   from './routes/history.js';
import { diffRouter }      from './routes/diff.js';
import { apiRouter }       from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServeConfigUiInput {
  agent_id?: string
  port?: number
  theme?: 'light' | 'dark'
  autoOpen?: boolean
}

export interface ServeConfigUiOutput {
  url: string
  port: number
  status: 'running'
  agentsAvailable: string[]
}

export function serveConfigUi(input: ServeConfigUiInput): Promise<ServeConfigUiOutput> {
  const app = express();
  const config = readAgentConfig();
  const port = input.port || config.settings.uiPort || parseInt(process.env.CONFIG_UI_PORT || '3456', 10);
  const theme = input.theme || config.settings.uiTheme || 'light';

  app.set('view engine', 'ejs');
  app.set('views', resolve(__dirname, 'views'));
  app.use(express.static(resolve(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Pasar tema a todas las vistas
  app.use((_req, res, next) => {
    res.locals.theme = theme;
    res.locals.agentId = input.agent_id || null;
    next();
  });

  app.use('/', dashboardRouter);
  app.use('/config', configRouter);
  app.use('/history', historyRouter);
  app.use('/diff', diffRouter);
  app.use('/api', apiRouter);

  return new Promise((resolvePromise) => {
    app.listen(port, () => {
      resolvePromise({
        url: `http://localhost:${port}`,
        port,
        status: 'running',
        agentsAvailable: [],
      });
    });
  });
}
