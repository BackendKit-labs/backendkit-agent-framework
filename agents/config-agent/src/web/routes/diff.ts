import { Router } from 'express';
import { readVersion, listVersions } from '../../storage/versionedStore.js';
import { diffConfigs } from '../../services/differ.js';
import { sanitizeAgentId } from '../../shared/validation.js';

export const diffRouter = Router();

diffRouter.get('/:agent_id', (req, res) => {
  const agent_id = sanitizeAgentId(req.params.agent_id);
  const versions = listVersions(agent_id);
  const v1 = (req.query.v1 as string) || versions[1]?.version;
  const v2 = (req.query.v2 as string) || versions[0]?.version;

  let diffResult = null;
  if (v1 && v2 && v1 !== v2) {
    const configA = readVersion(agent_id, v1);
    const configB = readVersion(agent_id, v2);
    if (configA && configB) {
      diffResult = diffConfigs(configA.config, configB.config, 'structured');
    }
  }

  res.render('diff', {
    title: `Diff: ${agent_id}`,
    agent_id,
    versions,
    v1,
    v2,
    diff: diffResult,
  });
});
