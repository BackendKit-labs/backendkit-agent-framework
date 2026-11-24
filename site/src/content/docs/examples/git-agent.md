---
title: git-agent
description: A terminal assistant for git built as a small team - your own safe tools, delegation between specialists, a read-only switch, a typed result and a budget.
---

*`check` needs nothing; the agent needs a model key. Lives in `examples/git-agent/`.*

An orchestrator that delegates to specialists (committer, brancher, merger, inspector, recovery), each with its own tools. It streams its output and prints each tool call. A **read-only mode** (`GIT_AGENT_READONLY`) removes every tool that changes the repository: one switch turns "can change things" into "can only look".

## Run it

```bash
cd examples/git-agent
npm install
npm run check        # 8 checks of the git tools, no model, no network
npm run dev          # the agent in your terminal
```

The agent reads its model from `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`, so any OpenAI-compatible API works. `npm run smoke` runs it against a throwaway repository with a real model, using only the read-only tools.

## How it works

**1. A tool is a definition, and the arguments never pass through a shell.** The schema validates what the model sends; the git helper receives an array of arguments, never a string to interpret (the checks try `$(...)` and quotes on purpose):

```ts
export const gitLog = defineTool({
    name: 'git_log',
    description: 'Show commit history. Supports filtering by author, path, count, and grep.',
    input: z.object({
        cwd:    z.string(),
        count:  z.number().int().min(1).max(100).default(20).describe('Number of commits'),
        author: z.string().optional().describe('Filter by author name/email'),
        grep:   z.string().optional().describe('Filter commit messages'),
    }),
    execute: async ({ cwd, count, author, grep }) => {
        const args = ['log', `--max-count=${count}`, '--pretty=format:%h  %an  %ar  %s'];
        if (author) args.push(`--author=${author}`);
        if (grep)   args.push(`--grep=${grep}`);
        return git(args, cwd);          // execFile with an array: no shell
    },
});
```

**2. A team: the orchestrator owns no tools, only who to ask.** Each specialist lists the tools it may use, and nothing else is visible to it:

```ts
const ORCHESTRATOR_PROFILE: AgentProfile = {
    id: 'orchestrator', /* ... */
    delegatesTo: ['committer', 'brancher', 'merger', 'inspector', 'recovery'],
    allowedTools: [],
};

const INSPECTOR_PROFILE: AgentProfile = {
    id: 'inspector', /* ... */
    allowedTools: ['git_status', 'git_log', 'git_diff', 'git_show', 'git_blame', 'git_stash'],   // read-only analysis
};
```

**3. One engine, one switch, one budget.** The read-only mode is just which tools you register; the budget stops a run that spends too much:

```ts
return createBaseEngine({
    providers: { default: provider }, defaultProvider: 'default',
    agents: [ORCHESTRATOR_PROFILE, COMMITTER_PROFILE, BRANCHER_PROFILE, MERGER_PROFILE, INSPECTOR_PROFILE, RECOVERY_PROFILE],
    tools: readOnly ? READ_ONLY_GIT_TOOLS : ALL_GIT_TOOLS,       // the switch
    defaultAgent: 'orchestrator',
    identity: { userId: opts.userId ?? process.env.USERNAME ?? 'me' },
    agentIdentity: opts.agentIdentity ?? selfAssertedIdentities(),
    transport, iterationMode: 'auto', maxIterations: 40,
    observability: { costTracker: { budget: { perRun: config.budgetUsd } } },
    abortOnBudget: true,
});
```

**4. A typed result instead of free text.** `/report` asks the model for an object that a schema validates, with one corrective retry:

```ts
const RepoReport = z.object({
    summary: z.string(),
    health: z.enum(['clean', 'needs-attention', 'risky']),
    uncommittedChanges: z.number().int().min(0),
    suggestions: z.array(z.string()).max(5),
});

return engine.generateObject(`Assess the health of this repository:\n\n${facts}`, RepoReport,
    { name: 'repo_report', agentId: 'inspector' });
```

## Read it for

- your own tools that never pass a value through a shell;
- [several agents in one engine](../../concepts/multi-agent/) and delegation between them;
- a [typed result](../../concepts/structured-output/) instead of free text;
- a [cost budget](../../concepts/observability-and-cost/) that stops the run.

Next: [git-analyst](../git-analyst/) serves an agent like this one to other programs.
