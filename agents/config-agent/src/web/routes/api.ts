import { Router } from 'express';
import { readVersion } from '../../storage/versionedStore.js';
import { sanitizeAgentId } from '../../shared/validation.js';

export const apiRouter = Router();

apiRouter.post('/reload/:agent_id', (req, res) => {
  sanitizeAgentId(req.params.agent_id);
  res.json({ status: 'not_supported', message: 'El agente no expone reload_config aún.' });
});

apiRouter.post('/test/:agent_id', (req, res) => {
  sanitizeAgentId(req.params.agent_id);
  res.json({ status: 'not_supported', message: 'La prueba de canales no está disponible desde la web aún.' });
});

apiRouter.get('/export/:agent_id', (req, res) => {
  const agent_id = sanitizeAgentId(req.params.agent_id);
  const format = (req.query.format as string) || 'env';
  const configVersion = readVersion(agent_id, 'current');

  if (!configVersion) {
    return res.status(404).json({ error: `Agente '${agent_id}' no encontrado` });
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${agent_id}-config.json"`);
    return res.json(configVersion.config);
  }

  // Formato env
  const lines = Object.entries(configVersion.config).map(([k, v]) => `${k}=${v}`);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${agent_id}.env"`);
  res.send(lines.join('\n'));
});
