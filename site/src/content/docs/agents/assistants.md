---
title: Assistants
description: Conversational agents with a few typed tools - the simplest kind, and the base of every other.
---

An **assistant** answers questions and uses a handful of tools to do it: look something up, read a record, draft a message. It runs when a person talks to it and stops when it answers.

## Build it

The [first agent](../../start/first-agent/) page builds one in forty lines. The scaffolder gives you the same shape:

```bash
npm create bk-agent@latest my-assistant      # choose the "single" architecture
```

An assistant is: a few `defineTool` tools, one `AgentProfile`, and `createBaseEngine`.

## What makes an assistant good

- **Few, sharp tools.** A model chooses better among five clearly described tools than among thirty.
- **Read-only where you can.** Declare `readOnly: true` on tools that look things up: they run without asking and in parallel.
- **A budget.** Set a cost limit per run so a loop cannot run up a bill ([cost and observability](../../concepts/observability-and-cost/)).
- **Memory, if it should remember.** Session history is kept; for facts across sessions use [memory](../../concepts/memory-and-learning/).

## Put it in front of people

| You want | Use |
|---|---|
| A terminal chat | `StdoutTransport` (or `CallbackTransport`) in your own script |
| A browser chat | [`agent-web`](../services/) serves it over WebSocket; `agent-web-ui` gives you a React chat |
| It callable from Claude, an IDE or another agent | [serve it over MCP](../services/) |

## When it grows

An assistant that needs to change things gets [governance](../../concepts/governance/). One that needs many specialities becomes a [team of agents](../../concepts/multi-agent/). One that should act without being asked becomes an [autonomous agent](../autonomous/).
