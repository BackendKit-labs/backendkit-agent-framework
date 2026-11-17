# vault-pilot

**Department agents that answer from a shared knowledge vault, each limited to its own folders.** The vault is a folder of Obsidian notes; `@backendkit-labs/agent-enterprise` indexes it and gives each department (HR, finance, sales, support, ops) an agent with a search tool scoped to that department's folder, plus the folders everybody shares.

Runs on `@backendkit-labs/agent-core` 0.45 and `@backendkit-labs/agent-enterprise` 0.11.

## Run it

```bash
npm install
npm run check          # 6 checks, no model, no key, no network

cp .env.example .env   # add DEEPSEEK_API_KEY, then:
npm run ask                                         # HR: parental leave
npm run ask -- finance "Who approves a 7000 EUR expense?"
npm run ask -- sales "How much discount can I give?"
```

`ask` indexes the sample vault, switches to the department agent you name and prints each tool call and the answer. It costs a fraction of a cent.

## The sample vault

`vault/` is a small company, Acme Logistics. The folder names are the ones `agent-enterprise` expects:

```
vault/
  general/     shared by every department   (company overview)
  politicas/   policies every department can search   (data handling)
  rrhh/        HR      (parental leave, remote work)
  finanzas/    Finance (expense approval limits, payroll calendar)
  soporte/     Support (refund process)
  ventas/      Sales   (discount policy)
```

Agents can write notes back (`write_knowledge`), so every run works on a **copy** in the temp folder. The sample is never modified.

## What `npm run check` proves

A scripted model plays the LLM, so what is checked is what the framework guarantees, not how smart a model is:

| Check | What it shows |
|---|---|
| HR answers from its own folder | The department search finds the HR note |
| A department also sees the shared folders | `general/` and `politicas/` are part of every department's search |
| Sales cannot reach HR content | The same question that finds the note for HR returns nothing of it for Sales (the check asks both, so it cannot pass by accident) |
| Sales cannot call the HR search tool | The call is refused: the tool is not one of Sales' allowed tools |
| Finance answers from its own folder | Its search returns finance notes and no support notes |
| The General agent searches everything | One agent with the whole vault, for questions that cross departments |

Isolation here is **what the tool can see**, not a request to the model to behave.

## How it is built

- `src/vault.ts` copies the sample vault to a throwaway folder.
- `src/check.ts` builds the setup with `createEnterpriseSetup`, runs a department agent with a scripted model and looks at what it was given back.
- `src/ask.ts` is the same setup with a real model (`DeepSeekProvider` from `agent-providers`) and a transport that prints what happens.

```ts
const setup = createEnterpriseSetup({ vaultPath, indexDir, sessionsDir, providers, defaultProvider: 'main' });
await setup.indexAll();                       // incremental: only new or changed notes are embedded
const engine = setup.engineFactory(sessionId, transport);
engine.switchAgent('hr');
await engine.run('How long is parental leave?');
```

## Things to know

- **HR and finance ask for a `local` provider** by default, so payroll and personal data need not leave your network. This example registers the same cloud model under both names; in a real deployment `local` would be an Ollama model.
- **The embedder is `SimpleEmbedder`**, which needs nothing installed. For a real vault use `OllamaEmbedder` (see the `agent-enterprise` page).
- **Your own vault:** point `vaultPath` at a folder with the same department names. Add `extraProfiles` for departments of your own.
