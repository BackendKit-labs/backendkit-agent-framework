---
title: Coding agents
description: Agents that read, edit and run code - ten specialists, file and command tools, project memory and an orchestration pipeline, ready to use.
---

`@backendkit-labs/agent-coding` is a complete coding agent on top of `agent-core`. One call gives you ten specialist agents, the filesystem tools, persistent project memory, skills and stack detection.

```bash
npm install @backendkit-labs/agent-coding
```

```ts
import { createCodingEngine } from '@backendkit-labs/agent-coding';

const engine = createCodingEngine({
  providers: { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
});

await engine.run('List all TypeScript files in src/ and tell me which ones have no tests');
```

All provider adapters are bundled: DeepSeek, OpenAI, Anthropic, Ollama (local, no key), Kimi, Grok and any OpenAI-compatible endpoint.

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

## Keep it safe

An agent that edits files and runs commands is the case governance exists for:

- **Approval.** Put a [policy and approver](../../concepts/governance/) in front of writes and commands, or the manual approval callback.
- **Confinement.** `createCodingEngine({ sandbox: { preset: 'ask' } })` puts every `run_command` behind [the sandbox](../sandboxed/).
- **Trusted projects.** Agents and skills defined by a project are only loaded when the project is trusted, so cloning a repository does not give it control of your agent.

## What else is in it

- **Skill packs** for Node/TypeScript, Go, Java, Kotlin and Python, activated by the stack it detects in the project (`package.json`, `go.mod`, `pom.xml`, `pyproject.toml`...), and installable from GitHub.
- **An orchestration pipeline** (`orchestration: true`) that runs before each model call: it detects the intent and the domain, scores the risk (reads only? writes files? runs commands?), applies domain policies, picks the best agent and reviews code-heavy answers. Customisable.
- **Learning**: repeated failures become lessons and proposed rules that a person approves ([memory and learning](../../concepts/memory-and-learning/)).
- **MCP servers** as extra tools.
- **`AGENT.md`**: a file in the project that the agent reads at the start of every session, with the stack, the conventions and the rules for that repository.

The `coding` architecture of `create-bk-agent` scaffolds a project with all of this and a terminal REPL.

Reference: the [`agent-coding` page](../../packages/coding/).
