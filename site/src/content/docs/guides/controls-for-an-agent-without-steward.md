---
title: Controls to turn on for an agent that acts for people
description: Which controls of the framework to enable for an agent that spends money or changes things, and which framework piece backs each one. A draft map, not a compliance claim.
---

:::caution[Draft map: not reviewed against any standard]
This page maps each **control objective** to the piece of the framework that supports it. It is a starting point for whoever has to make the case, **not a statement that the framework complies with ISO/IEC 42001, ISO/IEC 27001, Regulation (EU) 2024/1183 (eIDAS 2) or any other norm.** Reading those norms and deciding what satisfies them is for someone who knows them. Until that review is done, treat the third column as "what the framework gives you", never as "what the norm requires".
:::

**Goal:** you run an agent that buys, pays or changes records for people, and you are not using Steward (the product layer that wires these pieces together). You have to wire them yourself. This page lists the controls to turn on, in the order they usually matter, and where each one lives.

## The map

| Control objective | What the framework gives you | Where |
|---|---|---|
| Know what the agent did | An audit event for every tool call, hash-chained so a change in the middle is visible | [Governance](/concepts/governance/): `HashChainAuditSink`, `verifyAuditChain` |
| Let a third party check that evidence | Signed checkpoints, external anchors and an exportable bundle | `signCheckpoint`, `anchorAuditLog`, `exportAuditBundle`, `verifyAuditBundle` |
| Separation of duties | An approval can require a role, and the requester cannot approve their own request | `approverRoles` in an `ask`, `forbidSelfApproval` on the engine |
| Least privilege | Each agent sees only its tools; a policy decides per call; commands run confined; credentials are lent for one call | `allowedTools`, `ToolPolicy`, [`agent-sandbox`](/packages/sandbox/), `credentialBroker` |
| Delegated power with limits and an end date | A signed mandate: who the agent works for, what it may do, up to how much, until when | [`agent-mandates`](/packages/mandates/), `mandatePolicy` |
| Revocation | A hook your verifier calls on every use; if it cannot answer, the mandate counts as revoked | `isRevoked` of the mandate verifier |
| A person for what cannot be undone | A tool marked `destructive` always asks unless a policy says otherwise; approvals expire | `destructive`, the approver, approval expiry |
| Key management | **Outside the framework**: you bring the keys and the revocation source (a KMS, an HSM, or a product that does it) | Your platform |

## 1. Turn on the audit first

Everything else is easier to defend when the trail exists. Use a chained sink and keep the log somewhere the agent's process cannot rewrite.

```ts
import { createBaseEngine, HashChainAuditSink } from '@backendkit-labs/agent-core';

createBaseEngine({ /* ... */ audit: new HashChainAuditSink('./audit.log') });
```

The sink refuses to append to a log whose chain is already broken. Then, on a schedule, sign a checkpoint and, if you can, anchor the head of the chain somewhere the agent's host cannot write. A checkpoint signed with a key that host does not hold is what lets a third party trust the log without trusting you. The signing and anchoring calls are on the [governance page](/concepts/governance/).

## 2. Mark what cannot be undone, and put a person in front of it

A payment, a deletion, a message to a customer: define the tool with `destructive: true`. By default it asks every time. Loosen that only with a policy you can explain (see [Govern a payment tool](/guides/govern-a-payment-tool/)): small amounts run, large ones ask.

## 3. Separate who asks from who approves

When an `ask` carries `approverRoles`, only a person holding that role can answer it. Add `forbidSelfApproval` so the person who triggered the action cannot approve it. The framework does not know your users: you hand it a directory of who holds which role.

## 4. Give the agent a mandate instead of standing power

Without a mandate, an agent either asks every time or has a blanket permission. A mandate sits between the two: **inside the limits it signed, the agent acts alone; outside them it asks; without a valid one it does nothing.** Every audit event then names the mandate (id, issuer, the person it acts for, validity and a hash of the credential, never the credential itself).

`agent-mandates` is published on npm as a **reference verifier**: it reads a signed credential in a profile of our choosing, shaped like an SD-JWT VC. It is **not** the credential of any specific provider, and its reference verifier does not do selective disclosure or key binding (a credential that carries them is rejected). The credential of a wallet or an identity provider is an adapter to the same `Mandate`, and the package ships the pieces to write one (SD-JWT, and the rules every adapter applies); no adapter of a real provider exists yet. The limit it enforces is **per operation**, not accumulated. The [Governance concept page](/concepts/governance/) explains how a mandate fits with the identity of the agent.

## 5. Revocation

The verifier does not know whether a mandate was withdrawn after it was issued. You give it an `isRevoked(mandate)` function that asks your own status source. If that function throws, the mandate counts as revoked: not being able to check is not "fine".

## 6. Confine the commands, scope the credentials

If the agent runs commands, run them through [`agent-sandbox`](/packages/sandbox/): the working directory and paths are judged by where they really land, the network is closed unless the policy opens it, and the host environment does not reach a container. For secrets, use a `credentialBroker`, which lends a short-lived credential for one call after the call has been authorised.

## What is not covered

- **Keys and their custody.** Where keys live, who rotates them and how they are recovered are yours.
- **Regulatory dates and exact requirements.** The eIDAS 2 regulation was published in 2024; the specific implementing acts and what they ask of an agent acting for a person were **not verified** here.
- **An accumulated limit** ("up to 1000 in total"): the verifier compares each operation. Keeping what has been spent is a state somebody has to store.
- **Another currency** than the one in the mandate is outside its scope and asks.

The design and the reasons are in SPEC-0043 in the repository.
