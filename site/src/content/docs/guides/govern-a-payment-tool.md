---
title: Govern a payment tool
description: An agent that pays small invoices alone and needs a person for large ones - with a policy, an approver and a test that proves it.
---

**Goal:** a `pay_invoice` tool the model can call, where payments up to 10,000 go through and larger ones need a human. The rule lives in code, not in the prompt.

## 1. The tool

It is `destructive`: a payment cannot be undone.

```ts
import { defineTool, z } from '@backendkit-labs/agent-core';

export const pay = defineTool({
  name: 'pay_invoice',
  description: 'Pay an invoice',
  destructive: true,
  input: z.object({ invoiceId: z.string(), amount: z.number() }),
  execute: async ({ invoiceId }) => `paid ${invoiceId}`,      // call your treasury here
});
```

## 2. The agent

```ts
import type { AgentProfile } from '@backendkit-labs/agent-core';

export const treasurer: AgentProfile = {
  id: 'treasurer', name: 'Treasurer', icon: '💰', description: 'Pays invoices',
  systemPrompt: 'Pay the invoices you are asked to pay.',
  allowedTools: ['pay_invoice'],
};
```

## 3. The policy

By default a destructive tool *always* asks. Here we want something finer: small payments run, large ones ask a human.

```ts
import type { ToolPolicy } from '@backendkit-labs/agent-core';

export const rules: ToolPolicy = {
  decide(_principal, call) {
    if (call.tool.name === 'pay_invoice' && (call.args.amount as number) > 10_000) {
      return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'] };
    }
    return { effect: 'allow' };
  },
};
```

## 4. The approver

Something has to answer an `ask`. For a quick demonstration, a function that always says no:

```ts
const approver = {
  ref: { kind: 'human' as const, id: 'ana' },
  request: async () => ({
    decision: 'reject' as const,
    by: { kind: 'human' as const, id: 'ana' },
    reason: 'too much',
    at: new Date().toISOString(),
  }),
};
```

In a real system the approver asks a person (`consoleApprover()`), or you use a durable [approval store](../../concepts/governance/) so the person can answer tomorrow.

## 5. Run it twice

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

for (const amount of [500, 25_000]) {
  const engine = createBaseEngine({
    providers: { mock: scriptedProvider([
      { tool_calls: [{ id: 'p', name: 'pay_invoice', args: { invoiceId: 'INV-1', amount } }] },
      { content: 'done' },
    ]) },
    defaultProvider: 'mock', agents: [treasurer], defaultAgent: 'treasurer', tools: [pay],
    transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
    policy: rules, approver,
  });
  const result = await engine.run('pay INV-1');
  console.log(amount, result.toolCalls.map(c => `${c.name}:${c.success}`));
}
```

Output:

```
500    [ 'pay_invoice:true' ]      // allowed by the policy
25000  [ 'pay_invoice:false' ]     // asked, the person said no: the tool never ran
```

The scripted model *always* asks to pay. That is the point of the test: whatever the model wants, the policy decides.

## What to take from it

- The limit is in `decide`, so no prompt can move it.
- `accepts: ['human']` means an agent cannot approve it either.
- Add `audit: new HashChainAuditSink('audit.log')` and every call, allowed or refused, leaves a record.
- The check that matters is on `toolCalls` (what ran), not on the text.
