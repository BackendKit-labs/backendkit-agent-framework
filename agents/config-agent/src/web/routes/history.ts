import { Router } from 'express';
import { listVersions, readVersion, getCurrentVersionId } from '../../storage/versionedStore.js';
import { sanitizeAgentId } from '../../shared/validation.js';

export const historyRouter = Router();

historyRouter.get('/:agent_id', (req, res) => {
  const agent_id = sanitizeAgentId(req.params.agent_id);
  const versions = listVersions(agent_id);
  const currentVersion = getCurrentVersionId(agent_id);

  // Cargar detalle de cada versión
  const versionsDetail = versions.map(v => {
    const detail = readVersion(agent_id, v.version);
    return {
      ...v,
      isCurrent: v.version === currentVersion,
      changesCount: detail?.changes.length || 0,
    };
  });

  res.render('history', {
    title: `History: ${agent_id}`,
    agent_id,
    versions: versionsDetail,
    currentVersion,
  });
});
