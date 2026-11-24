---
title: git-analyst
description: A coding agent served over MCP, so any MCP client can call it as a tool - with a cost budget on a service other programs call.
---

*Needs a model key. Lives in `examples/git-analyst/`.*

A coding agent **served over MCP** with `AgentMCPServer`. Its tools (`git_summarize`, `git_diff_review`, `git_release_notes`) each turn their arguments into a prompt, so any MCP client (Claude, an IDE, another agent) can call "summarize the last 20 commits" as if it were a function.

## Run it

```bash
cd examples/git-analyst
npm install
npm run dev          # an MCP server at http://127.0.0.1:3010/mcp
```

It reads an optional **cost budget** from the environment (`AGENT_BUDGET_USD`, with the model's prices) that stops a call that spends too much.

## How it works

**1. A tool of the server is a schema and a prompt.** The client sends arguments; the server turns them into the request the agent works on. The model is in the middle, unlike a [direct tool server](../../concepts/mcp/):

```ts
const server = new AgentMCPServer({
    name: 'git-analyst', version: '1.0.0', port: PORT,
    tools: [
        {
            name: 'git_summarize',
            description: 'Summarize recent git commits grouped by features, bug fixes, and chores.',
            schema: {
                cwd:         z.string().optional().describe('Repository path (defaults to server cwd)'),
                max_commits: z.number().optional().describe('Number of commits to analyze (default 20)'),
            },
            buildPrompt: ({ cwd, max_commits }) =>
                `Run the command: git -C "${cwd ?? CWD}" log --oneline -${max_commits ?? 20}\n` +
                `Then write a concise summary grouped by: Features, Bug Fixes, and Chores. Be brief.`,
        },
        /* git_diff_review, git_release_notes ... */
    ],
```

**2. Each call gets an engine, with its identity and, optionally, a budget.** The engine behind the tools is a coding engine; the server says who it is and for whom it acts, and caps what one call may spend:

```ts
    engineFactory: (transport) =>
        createCodingEngineFromConfig({
            appName: 'git-analyst', transport,
            ...costOptions(),                                   // AGENT_BUDGET_USD, prices
            agentIdentity: selfAssertedIdentities(),            // who this agent is
            identity: { userId: process.env.USERNAME ?? 'me' }, // on whose behalf
        }),
});

server.start();
```

**3. The budget is plain configuration of the engine:**

```ts
observability: { costTracker: { inputPricePerMToken, outputPricePerMToken, budget: { perRun: budget } } },
abortOnBudget: true,
```

## Read it for

- [serving an agent](../../agents/services/) as tools for other programs;
- putting a [budget](../../concepts/observability-and-cost/) on a service that others call and you pay for;
- the difference between this (a model decides how to answer) and a [direct tool server](../../concepts/mcp/#as-a-server-without-a-model) (no model).
