# @backendkit-labs/agent-coding

A production-ready coding agent engine built on `@backendkit-labs/agent-core`. Bundles 10 specialized agents, filesystem tools, multi-provider support (DeepSeek, OpenAI, Anthropic, Ollama, Kimi, Grok), automatic stack detection, persistent memory, QA review, reflection, and an orchestration pipeline — all in a single `createCodingEngine()` call.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-coding)](https://www.npmjs.com/package/@backendkit-labs/agent-coding)

---

## Installation

```bash
npm install @backendkit-labs/agent-coding
```

All provider adapters are bundled — no separate packages needed.

---

## Quick start

```typescript
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createCodingEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  providers:       { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
});

await engine.run('List all TypeScript files in src/ and tell me which ones have no tests');
```

That single call gives you: 10 specialized agents, filesystem tools (read/write/edit/search), persistent project memory, skill loading, and stack auto-detection.

---

## What else is in it

Everything below is in the **[reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md)**: each topic has its own section with examples.

| Topic | What it covers |
|---|---|
| [createCodingEngine](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#createcodingengine) | The primary factory. Returns a fully configured `AgentEngine`. |
| [createCodingEngineFromConfig](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#createcodingenginefromconfig) | Reads credentials from `~/.{appName}/config.json`. |
| [Providers](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#providers) | --- |
| [Built-in agents](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#built-in-agents) | Ten specialist agents are bundled. |
| [Built-in tools](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#built-in-tools) | All agents have access to these tools via `CODING_TOOLS` |
| [Skill packs](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#skill-packs) | Built-in packs activate based on detected project stack |
| [Orchestration pipeline](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#orchestration-pipeline) | When `orchestration: true`, an intelligent routing layer runs before each LLM call |
| [Learning](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#learning) | With `orchestration` on, the project learns from its audit gates and from tool calls that keep failing (the learning module of `agent-core`) |
| [MCP server integration](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#mcp-server-integration) | --- |
| [Multi-agent examples](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#multi-agent-examples) | --- |
| [Config file](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#config-file) | `~/.bk-agent/config.json` |
| [`agent-coding/cli`](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/coding/REFERENCE.md#agent-codingcli) | The file-based adapters and the terminal-app pieces that used to live in `agent-core` (SPEC-0016) |
