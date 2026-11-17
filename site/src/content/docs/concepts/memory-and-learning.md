---
title: Memory and learning
description: How an agent remembers across sessions, and how repeated failures become lessons that a person approves.
---

Two different things, often confused. **Memory** is what the agent knows. **Learning** is what the agent changes about itself - and in this framework, nothing it learns applies itself.

## Memory

Session history is kept for you. For anything that should outlive a session there is a three-layer memory:

| Layer | Holds | Example |
|---|---|---|
| `EpisodicMemory` | What happened | "Last week we refactored auth" |
| `SemanticMemory` | What is known | "Alice owns the auth module" |
| `ProceduralMemory` | How to do something | "Deploy: build, push, apply" |

```ts
import { createMemorySystem } from '@backendkit-labs/agent-core';

const memory = createMemorySystem({
  episodic:   { provider: 'json', path: './memory/episodes.json' },
  semantic:   { provider: 'json', path: './memory/knowledge.json' },
  procedural: { provider: 'json', path: './memory/patterns.json' },
  retention:  { maxEpisodes: 500, summarizeAfter: 50 },     // prunes by relevance; can compress with a model
});

const engine = createBaseEngine({ /* ... */ memorySystem: memory });
```

Stores are pluggable (an in-memory one for tests, a JSON file for production, your own through `MemoryStoreBackend`), and memory *tools* let the agent write its own notes. Old, unused entries fade by a forgetting curve.

## Learning

```ts
import { createLearning } from '@backendkit-labs/agent-core';

const learning = createLearning({ dir: './learning' });
const engine = createBaseEngine({ /* ... */ learning });
```

With `learning` on the engine:

1. Every failed, timed-out, denied or blocked tool call becomes an **experience**.
2. The **same failure seen three times** (the tool, the kind of failure and, when the error has one, its code) becomes a **lesson** in that agent's system prompt and a **proposed rule** that waits for a person.
3. A person approves it, or not. **An agent cannot approve what it learned.** Approving, teaching and adding a rule require a human by default.

```ts
for (const p of await learning.proposals()) console.log(p.id, p.reason);
await learning.approve(id, { kind: 'human', id: 'ana' });
await learning.retire(id);                       // withdraw an approved rule
await learning.teach({ text: 'Totals are rounded to 2 decimals.', tools: ['post_invoice'] }, { kind: 'human', id: 'ana' });
```

What this gives you:

- **A tool can say what to do about each error.** `defineTool({ ..., errorHints: { ERP_PERIOD_CLOSED: 'The period is closed: post it in the next one.' } })`.
- **Lessons a person can write and review in git:** a lesson exports to markdown with a front matter and imports back.
- **Tenants never share what they learn.**
- **Stable prompt text.** A lesson carries no counts or dates, so more failures of the same pattern do not change the prompt and prompt caching keeps working.
- **Outcomes, not only failures:** `learning.trackOutcome({ agentId, domain, subject, ok, context })` counts a success against its subject, so a pattern is judged against how often the thing works *in that circumstance*. The trading-bot example uses this to learn which breakouts are worth taking.
- **Simulated time** for backtests and simulations.

## Skills

A **skill** is a block of instructions an agent loads when it is relevant (a PR review checklist, a stack's conventions). Skills can be defined inline with `SkillRegistry`, installed as packs, and invoked by slash commands in a terminal agent. `agent-coding` activates the packs for the stack it detects.

See it working: [the trading-bot example](../../examples/research-desk/).
