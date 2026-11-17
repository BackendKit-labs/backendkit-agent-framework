---
title: Starter examples
description: Four small, current examples to read first - a flow with no model, a real agent in a terminal, an agent served over MCP, and department agents over a knowledge vault.
---

These four live in the `examples/` folder of the monorepo and run on **agent-core 0.45**. Clone the repository, go into the folder and run them. They are the first four steps of the [ladder](../overview/).

## flows

*No model. Needs only Node.*

A business flow as data: a YAML file run by `runFlow` with a journal, a human approval and a resume. The executor is scripted, so you see the engine and nothing else.

```bash
npm run build -w packages/core     # from the repository root, once
node examples/flows/run.mjs
```

```
first run : awaiting_approval | ran: collect-sales, collect-costs
pending   : [ 'close-2026-10-report' ]
second run: completed | ran: report, publish
report    : [analyst] Write the month report for Acme
```

The first run stops at the approval. A person decides. The second run uses the same run id, so the two collectors are **not** run again. [A durable flow with an approval](../../guides/durable-flow-with-approval/) explains each line.

## git-agent

*Needs a model key.*

A terminal assistant for git, built as a small team: an orchestrator that delegates to specialists (committer, brancher, merger, inspector, recovery), each with its own tools. It streams its output and prints each tool call. A **read-only mode** (`GIT_AGENT_READONLY`) removes every tool that changes the repository, so one switch turns the agent from "can change things" into "can only look".

```bash
cd examples/git-agent
npm install
npm run check        # 8 checks of the git tools, no model, no network
npm run dev          # the agent in your terminal
```

The agent reads its model from `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`, so any OpenAI-compatible API works.

`npm run smoke` runs the agent against a throwaway repository with a real model, using only the read-only tools. It checks that the orchestrator delegates to the inspector and calls `git_log`, that a typed, validated repository report comes back, and that a cost budget stops the run. On a real model it passed 3 of 3 for about a tenth of a cent.

**Read it for:**

- your own tools that never pass a value through a shell (the checks try `$(...)` and quotes on purpose);
- several agents in one engine and delegation between them;
- streaming events from the engine to a terminal;
- a typed result (`/report`) instead of free text;
- a cost budget that stops the run.

## git-analyst

*Needs a model key.*

A coding agent **served over MCP** with `AgentMCPServer`. Its tools (`git_summarize`, `git_diff_review`, `git_release_notes`) each turn their arguments into a prompt, so any MCP client (Claude, an IDE, another agent) can call "summarize the last 20 commits" as a tool.

```bash
cd examples/git-analyst
npm install
npm run dev          # an MCP server at http://127.0.0.1:3010/mcp
```

It reads an optional **cost budget** from the environment (`AGENT_BUDGET_USD`, with the model's prices) that stops a call that spends too much.

**Read it for:** [serving an agent](../../agents/services/) as tools, and putting a [budget](../../concepts/observability-and-cost/) on a service other programs call.

## vault-pilot

*`ask` needs a model key; the checks need nothing.*

[Knowledge agents](../../agents/knowledge/): one agent per department (HR, finance, sales, support, ops) answering from a shared **Obsidian vault**, each able to search only its own folder plus the shared ones. The sample vault is a small company, so you can read the notes and see where an answer came from.

```bash
cd examples/vault-pilot
npm install
npm run check        # 6 checks, no model, no key, no network
npm run ask          # HR answers about parental leave, from the vault
npm run ask -- finance "Who approves a 7000 EUR expense?"
```

The checks use a scripted model, so they test what the framework guarantees. The same question that finds the parental-leave note for HR finds nothing of it for Sales, and Sales cannot even call the HR search tool. Isolation is **what the tool can see**, not a request to the model to behave.

**Read it for:** `createEnterpriseSetup`, department profiles with scoped search, indexing a vault, and how to test an agent's boundaries offline.

## Next

Once these make sense, move to the deep dives: [research-desk](../research-desk/) adds memory and learning, [release-captain](../release-captain/) adds a model that supervises flows, and [audit-desk](../audit-desk/) runs flows across processes on a real Redis.
