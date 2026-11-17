---
title: Autonomous agents
description: Agents that run without being asked - on a schedule, on an event or on a webhook.
---

An **autonomous agent** is started by something other than a person typing: a clock, an event in your system, a call from another service. Nobody is watching, which is why governance, budgets and audit matter more here than anywhere else.

## On a schedule

```ts
import { createAutonomousAgent } from '@backendkit-labs/agent-core';

const standup = createAutonomousAgent({
  engine: myEngine,
  schedule: '0 9 * * 1-5',                       // cron: weekdays at 9
  buildPrompt: () => 'Generate a daily standup summary from recent git commits and open PRs.',
  onResult: output => slack.postMessage('#standup', output),
  onError: err => logger.error('[standup-agent]', err),
});

await standup.start();
await standup.stop();
```

## On an event

```ts
import { EventBus } from '@backendkit-labs/agent-core';

const bus = new EventBus();

bus.on('deployment.failed', async payload => {
  const analysis = await engine.run(`Investigate this deployment failure:\n${JSON.stringify(payload, null, 2)}`);
  await pagerduty.alert({ summary: analysis.text });
});

await bus.emit('deployment.failed', { service: 'payment-api', version: '2.1.4', errorLog });
```

## From a server: cron, webhooks and queues

When the agent lives behind `agent-web`, a `TriggerBus` runs a fresh engine per trigger: on a cron schedule, on an incoming webhook, or for each job of a BullMQ queue.

```ts
import { TriggerBus } from '@backendkit-labs/agent-web';

const triggers = new TriggerBus(engineFactory)
  .addCron({
    name: 'health-check',
    schedule: '*/15 * * * *',
    buildPrompt: () => 'Check all API endpoints and report any that are down.',
    onComplete: ({ output }) => { if (output.includes('DOWN')) pagerduty.alert(output); },
  })
  .addWebhook({
    name: 'github-pr',
    path: '/webhooks/github',
    secret: process.env.GITHUB_SECRET,            // verified as an HMAC over the raw body
    buildPrompt: body => `Review PR #${(body as any).pull_request.number}`,
    onComplete: ({ output }) => github.comment(output),
  });
```

A webhook answers immediately and the run continues in the background, so use `onComplete` for the result.

## Make unattended runs safe

| Concern | What to use |
|---|---|
| It must not spend without limit | A cost budget per run that stops the turn ([cost and observability](../../concepts/observability-and-cost/)) |
| It must not do the irreversible alone | [Policy and durable approvals](../../concepts/governance/): the ask waits as pending until a person answers, even days later |
| You must be able to reconstruct what it did | An audit sink: one record per call |
| A long process must not be lost | A [flow](../../concepts/flows/) with a journal |
| Who started it | The trigger name travels with the run |

The `autonomous` architecture of `create-bk-agent` scaffolds a project with cron, webhook and event triggers.
