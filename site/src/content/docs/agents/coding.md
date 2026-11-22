---
title: Coding agents
description: Agents that read, edit and run code - ten specialists, file and command tools, project memory and an orchestration pipeline, ready to use.
---

`@backendkit-labs/agent-coding` is a complete coding agent on top of `agent-core`. One call gives you ten specialist agents, the filesystem tools, persistent project memory, skills and stack detection.

```bash
npm install @backendkit-labs/agent-coding
```

## The smallest one

```ts
import { createCodingEngine } from '@backendkit-labs/agent-coding';

const engine = createCodingEngine({
  providers: { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
});

await engine.run('List all TypeScript files in src/ and tell me which ones have no tests');
```

All provider adapters are bundled: DeepSeek, OpenAI, Anthropic, Ollama (local, no key), Kimi, Grok and any OpenAI-compatible endpoint.

## One you can leave running

The same engine, with what an agent that edits files and runs commands should have: a sandbox, a person who approves, a cost limit, a time limit per tool and a tool of your own.

```ts
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { readFile } from 'node:fs/promises';

// A tool of your own: it only reads, so it is declared read-only and runs without asking.
const countLines = defineTool({
  name: 'count_lines',
  description: 'Count the lines of a file inside the project',
  readOnly: true,
  input: z.object({ path: z.string().describe('Path relative to the project') }),
  execute: async ({ path }) => String((await readFile(path, 'utf8')).split('\n').length),
});

const engine = createCodingEngine({
  providers: { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
  workingDir: process.cwd(),

  // Every run_command goes through the sandbox: workspace-write, no network. Writes and commands ask first.
  sandbox: { preset: 'ask' },
  onToolApproval: async (tool, agent, argsPreview) => {
    console.log(`\n${agent} wants to run ${tool}: ${argsPreview}`);
    return (await askThePerson('Allow? [y/N] ')) ? 'approve' : 'reject';        // your own prompt; 'approve_all' is also valid
  },

  extraTools: [countLines],                                                       // after the coding tools

  // A run that costs more than 50 cents is stopped, and no single tool call may take more than two minutes.
  observability: { costTracker: { inputPricePerMToken: 0.3, outputPricePerMToken: 1.2, budget: { perRun: 0.5 } } },
  abortOnBudget: true,
  toolTimeoutMs: 120_000,
});

const result = await engine.run('Add a test for the date parser in src/date.ts and run the suite');
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`));
```

`approve_all` stops asking for the rest of the session, **except for destructive tools and package installs**: an irreversible action is never approved in bulk. Something that takes longer than `toolTimeoutMs` is reported to the model as timed out and as possibly still running, so it checks before it repeats a command that writes.

## The ten agents

| Agent | Specialty |
|---|---|
| `general` | General purpose, the default starting point |
| `architect` | System design, ADRs, architecture decisions |
| `backend-agent` | APIs, server logic, databases |
| `frontend-agent` | React, CSS, accessibility, UX |
| `devops-agent` | CI/CD, Docker, Kubernetes, infra |
| `database-agent` | SQL, indexes, migrations, query tuning |
| `security-reviewer` | Security audits, OWASP, threat modeling |
| `qa-engineer` | Test strategy, edge cases, QA reviews |
| `documentation-agent` | Docs, READMEs, API docs, changelogs |
| `refactoring-agent` | Code cleanup, technical debt, design patterns |

Orchestration routes a task to the right one, or you select an agent yourself. You can add your own profiles.

## The tools

`read_file`, `write_file`, `edit_file` (a targeted patch), `list_directory`, `run_command` and `search_files`, plus tools for the agent's own notes: `save_context`, `save_learning`, `save_audit`, `get_latest_audit`, `list_audits`, `save_user_preference` and `update_session`.

## Your own tools

`createCodingEngine({ extraTools: [myTool] })` adds tools of yours after the coding tools. A tool with the name of an existing one does **not** replace it. To replace or wrap a built-in (to add a path check, say), use the registry of the engine:

```ts
const engine = createCodingEngine({ /* ... */ });
engine.getTools().unregister('write_file');
engine.getTools().register(guardedWriteFile);   // the next run uses it
```

This changes what a tool does, not who may call it: that is still the sandbox and the approval.

## Keep it safe

An agent that edits files and runs commands is the case governance exists for:

- **Approval.** `onToolApproval` is asked before writes and commands, and the `sandbox` preset decides which tools ask. For [policies, roles and stored approvals](../../concepts/governance/) build the engine with `createBaseEngine` and the coding tools.
- **Confinement.** `sandbox: { preset: 'ask' }` puts every `run_command` behind [the sandbox](../sandboxed/). If the confinement cannot be enforced, the command does not run.
- **What a command can read.** Without a `sandbox`, `run_command` runs on your machine, and the model reads whatever a command prints (`printenv` and `env` are allowed). So the environment a command starts with is **scrubbed**: variables that look like credentials (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, cookies, private values, DSNs) and any variable whose value is a connection string with a password (`postgres://user:pass@host`) are not passed. Let chosen variables through with `BK_RUN_COMMAND_ENV_ALLOW=GH_TOKEN,NPM_TOKEN` (comma separated, `*` wildcards) when a command needs them, or restore the old behaviour, the whole environment, with `BK_RUN_COMMAND_ENV=inherit`. The list of allowed binaries is not isolation (`node -e` and `python -c` run anything): for that, use the `sandbox`.
- **Trusted projects.** Agents and skills defined by a project are only loaded when the project is trusted, so cloning a repository does not give it control of your agent.
- **Plugins you type by hand.** `/plugin add <package>` installs a package you name without running its install scripts; the known plugins of the framework install normally. A version is accepted (`/plugin add some-plugin@1.2.3`).

## What else is in it

- **Skill packs** for Node/TypeScript, Go, Java, Kotlin and Python, activated by the stack it detects in the project (`package.json`, `go.mod`, `pom.xml`, `pyproject.toml`...), and installable from GitHub.
- **An orchestration pipeline** (`orchestration: true`) that runs before each model call: it detects the intent and the domain, scores the risk (reads only? writes files? runs commands?), applies domain policies, picks the best agent and reviews code-heavy answers. Customisable.
- **Learning**: repeated failures become lessons and proposed rules that a person approves ([memory and learning](../../concepts/memory-and-learning/)).
- **MCP servers** as extra tools (`mcpServers`).
- **`AGENT.md`**: a file in the project that the agent reads at the start of every session, with the stack, the conventions and the rules for that repository.

The `coding` architecture of `create-bk-agent` scaffolds a project with all of this and a terminal REPL.

Reference: the [`agent-coding` page](../../packages/coding/).
