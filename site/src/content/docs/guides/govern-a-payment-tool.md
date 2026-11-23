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
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

for (const amount of [500, 25_000]) {
  const engine = createBaseEngine({
    agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
    identity: { userId: 'me' },                // on whose behalf it acts
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

## 6. Who may approve

So far "a human" means any person. In a company, a payment above 10k is approved by finance, and not by the person who asked for it. Two additions say so.

In the policy, name the role. The engine **checks** it; it does not just hint at it:

```ts
return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'], approverRoles: ['finance'] };
```

The engine learns what roles a person has from **your** user system, through a directory. It never reads them from what the caller says:

```ts
const users: Record<string, { roles: string[] }> = {
  ana: { roles: ['finance'] },
  carlos: { roles: ['finance'] },      // finance too, and he is the one who asks
  'intern-17': { roles: ['intern'] },
};
const approverDirectory = { describe: (by: { id: string }) => users[by.id] };   // undefined: unknown id
```

Turn on four eyes, and say who the agent acts for:

```ts
const answerAs = (id: string) => ({
  ref: { kind: 'human' as const, id },
  request: async () => ({ decision: 'approve' as const, by: { kind: 'human' as const, id }, at: new Date().toISOString() }),
});

for (const who of ['carlos', 'intern-17', 'ana']) {
  const engine = createBaseEngine({
    agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
    identity: { userId: 'me' },                // on whose behalf it acts
    /* providers, agents, tools and transport as in step 5, with amount 25_000 */
    policy: rules,
    approver: answerAs(who),
    approverDirectory,
    forbidSelfApproval: true,
    identity: { userId: 'carlos' },                 // carlos asked for this payment
  });
  const result = await engine.run('pay INV-1');
  console.log(who, result.toolCalls.map(c => `${c.name}:${c.success}`));
}
```

Output:

```
carlos     [ 'pay_invoice:false' ]   // he is in finance, but he asked for it: four eyes
intern-17  [ 'pay_invoice:false' ]   // not in finance
ana        [ 'pay_invoice:true' ]    // another person, with the role: it runs
```

The refusal reaches the audit event with its reason, and the one that ran records which role covered the approval (`approval.authority`).

The same checks apply to a durable approval: when someone resolves a stored request, `engine.runApproved(id)` checks the role and who asked again, with the policy and the directory of that moment. Who asked is what the stored request recorded, so a worker that runs it later with no identity of its own refuses it too.

**The framework does not authenticate anyone.** `by.id` has to be a person your application has already verified (a session, a token, single sign-on). Take it from that, never from a request body. The directory says what a verified person may approve; it cannot tell whether the id is who it claims to be. Without a directory, an `ask` with `approverRoles` is refused: an approval that cannot be checked is not accepted.

## What to take from it

- The limit is in `decide`, so no prompt can move it.
- `accepts: ['human']` means an agent cannot approve it either.
- `approverRoles` says who may approve and the engine checks it against your directory; `forbidSelfApproval` keeps the person who asked from approving.
- Add `audit: new HashChainAuditSink('audit.log')` and every call, allowed or refused, leaves a record.
- The check that matters is on `toolCalls` (what ran), not on the text.
