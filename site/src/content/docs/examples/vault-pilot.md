---
title: vault-pilot
description: Department agents answering from a shared knowledge vault, each limited to its own folders - and how to test those boundaries offline.
---

*`ask` needs a model key; the checks need nothing. Lives in `examples/vault-pilot/`.*

[Knowledge agents](../../agents/knowledge/): one agent per department (HR, finance, sales, support, ops) answering from a shared **Obsidian vault**, each able to search only its own folder plus the shared ones. The sample vault is a small company, so you can read the notes the answers come from.

## Run it

```bash
cd examples/vault-pilot
npm install
npm run check        # 7 checks, no model, no key, no network
npm run ask          # HR answers about parental leave, from the vault
npm run ask -- finance "Who approves a 7000 EUR expense?"
```

## How it works

**1. One setup builds every department.** You give it the vault, the providers and who acts; it indexes the folders and gives each agent a search tool scoped to its own folder plus the shared ones:

```ts
const providers = new ProviderRegistry();
providers.register('main', provider);
providers.register('local', provider);       // HR and finance ask for a local model

const setup = createEnterpriseSetup({
  ...ws,                                      // vaultPath, indexDir, sessionsDir
  providers, defaultProvider: 'main',
  agentIdentity: selfAssertedIdentities(),
  identity: { userId: 'me' },
});
await setup.indexAll();

const engine = setup.engineFactory('session-1', transport);
engine.switchAgent('hr');
await engine.run('How long is parental leave for the birth parent?');
```

**2. The boundary is what the tool can see, not what the model is told.** HR's search reaches `rrhh`, `general` and `politicas`; Sales' reaches `ventas` and the shared ones. Asking Sales the HR question finds nothing, and Sales cannot even call the HR search tool.

**3. The General agent does not see HR or Finance by default.** What it retrieves goes to the default provider, which may be remote, while HR and Finance use a local model. The operator can open it, knowing what that means:

```ts
createEnterpriseSetup({
  ...ws, providers, defaultProvider: 'main',
  agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' },
  globalExcludeFolders: [],        // let General search the whole vault
});
```

**4. The checks use a scripted model**, so they test what the framework guarantees, not what a model happens to say. A scripted turn calls one search tool with one query, and the check reads what came back:

```ts
await check('Sales cannot reach HR content through its own search', async () => {
  const hr = await callTool(ws, 'hr', ENTERPRISE_TOOLS.SEARCH_HR, 'parental leave weeks birth parent');
  assert.match(hr.text, /16 weeks/, 'control: the same question does find the note when HR asks');
  const sales = await callTool(ws, 'sales', ENTERPRISE_TOOLS.SEARCH_SALES, 'parental leave weeks birth parent');
  assert.doesNotMatch(sales.text, /16 weeks|parental leave policy/i);
});
```

## Read it for

- `createEnterpriseSetup`, department profiles with scoped search, indexing a vault;
- isolation that is **what the tool can see**, not a promise in a prompt;
- how to [test an agent's boundaries offline](../../guides/test-an-agent/), with a control that proves the check can fail.
