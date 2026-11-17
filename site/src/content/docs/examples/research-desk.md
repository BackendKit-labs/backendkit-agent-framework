---
title: research-desk (trading-bot)
description: A paper-trading desk of five agents as a flow - parallel analysts, a decision, an approved execution - with memory and learning.
---

`trading-bot` is a paper-trading bot built as a **test bench** for the framework. **No real money and no exchange**: the market is synthetic and seeded (same seed, same candles). It has three hidden regimes, and the bot has to learn which breakouts are worth taking.

## The bot

| Layer | What it is | Framework piece |
|---|---|---|
| Reasoning | an LLM (DeepSeek live, or an offline mock) | `createBaseEngine`, providers |
| Action | `get_candles`, `get_indicators`, `get_portfolio`, `place_order`, `close_position`: deterministic | `defineTool`, `errorHints` |
| Safety | a risk gate inside `place_order`, plus rules a person approved | `ToolError`, `learnedRules` |
| Memory | episodic (each trade), semantic (the playbook), procedural (which entries worked) | `createMemorySystem` |
| Learning | losing trades become lessons in the prompt and proposed rules that wait for a person | `createLearning`, `trackOutcome` |
| Reporting | what each session did, the prompt the model got, the budget | `RunResult`, `engine.budgetExceeded`, `agent-testkit` |

```bash
npm run smoke        # offline
npm run sim          # the same seed side by side: naive, with memory, with learning
npm run live         # sessions with DeepSeek (needs a key; costs a few cents, capped)
```

## The research desk

The same market, as a **flow of five agents**: three analysts in parallel (technical, regime, risk), then a decider, then an executor that needs an approval.

```
technical ┐
regime    ├─> decider ─> executor   (the executor: a gate; skipped if the decider says no)
risk      ┘
```

`desk:smoke` runs it with a deterministic stand-in for the models and checks the plumbing: parallel steps, context between steps, the approval, resume, a step skipped by a condition. `desk:live` runs it with DeepSeek in every agent: 6 flows, 51 model calls, about 0.018 USD, with the analysts running 3.2 times faster in parallel than in sequence.

## What it found in the framework

Four findings, three fixed:

1. **The claim of a run was never renewed**, so a long flow could lose its claim mid-run. Now it renews, and a renewal that finds the claim taken stops the run.
2. **A step could not depend on another step's answer.** Now `when: { step, contains | equals | matches, not? }` skips a step cleanly, without failing the flow, asking nobody and skipping what depends on it.
3. **A flow had no total cost.** Now `FlowResult.costUsd` adds up what the steps report.
4. The file journal costs about 4 ms per event on Windows. Left as it is; the single-host `NdjsonRunJournal` that came later is faster.

One lesson that is not about the framework: a counter that reads the model's text ("Order placed") fails with a real model. Count successful tool calls (`RunResult.toolCalls`).
