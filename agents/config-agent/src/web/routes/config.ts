import { Router } from 'express';
import { readVersion, writeVersion, getCurrentVersionId, listVersions } from '../../storage/versionedStore.js';
import { readSchema } from '../../storage/schemaStore.js';
import { readSecrets } from '../../storage/secretStore.js';
import { validateConfig as validate } from '../../services/validator.js';
import { inferSchema } from '../../services/inferer.js';
import { sanitizeAgentId } from '../../shared/validation.js';

export const configRouter = Router();

configRouter.get('/:agent_id', (req, res) => {
  const agent_id = sanitizeAgentId(req.params.agent_id);
  const currentVersion = getCurrentVersionId(agent_id);
  if (!currentVersion) {
    return res.status(404).send(`Agente '${agent_id}' no encontrado`);
  }

  const configVersion = readVersion(agent_id, currentVersion);
  const schema = readSchema(agent_id) || (configVersion ? inferSchema(configVersion.config) : null);
  const secrets = readSecrets(agent_id);
  const versions = listVersions(agent_id);
  const validation = configVersion && schema ? validate(configVersion.config, schema) : null;

  res.render('config-form', {
    title: `Config: ${agent_id}`,
    agent_id,
    config: configVersion?.config || {},
    schema,
    secrets,
    currentVersion,
    versions,
    validation,
  });
});

configRouter.post('/:agent_id', (req, res) => {
  const agent_id = sanitizeAgentId(req.params.agent_id);
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};

  const newConfig = { ...currentConfig };
  const changes: { key: string; action: 'added' | 'updated' }[] = [];

  for (const [key, value] of Object.entries(req.body)) {
    if (key === '_message') continue;
    if (JSON.stringify(currentConfig[key]) !== JSON.stringify(value)) {
      newConfig[key] = value;
      changes.push({
        key,
        action: key in currentConfig ? 'updated' : 'added',
      });
    }
  }

  if (changes.length > 0) {
    const message = (req.body._message as string) || `web update (${changes.length} campos)`;
    writeVersion(agent_id, newConfig, changes, message);
  }

  res.redirect(`/config/${agent_id}`);
});
