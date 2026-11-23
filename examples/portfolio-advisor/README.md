# portfolio-advisor

A portfolio advisor made of four agents over a **simulated market and a simulated broker**. It is not advice and it trades nothing real. It exists to put a realistic job under the governance of the framework and see what holds: identity of each agent, a signed audit, a power (mandate) with proof of possession, approval by role with four eyes, and delegation.

It runs with **no key and no network**: a scripted model plays the LLM, so the tests check what the framework lets through and not what a model happens to say.

```bash
npm install
npm test          # 24 tests, offline
```

The domain (what the agents are *about*) follows the design of a finance portfolio system: the decision matrix (§6), the default weights (§8.3) and the conflict rules (§8.5) of its `design.md`. Nothing in the numbers is invented.

## The agents

| Agent | Tools | Power it holds |
|---|---|---|
| `analyst` | `get_portfolio`, `get_signal` | read |
| `rebalancer` | `get_portfolio`, `plan_rebalance` | read |
| `executor` | `place_order` (destructive) | trade, up to **5,000 EUR per order** |
| `orchestrator` | none; `delegatesTo` the three | only `ask_agent` (handing work over) |

## What is framework and what is the example's own code

The point of the example is that **what governs the agents is framework**. This table is the contract: each requirement, what implements it, and the code the example had to write itself.

| Requirement | Framework primitive | The example's own code |
|---|---|---|
| Each agent is someone, not "the advisor" | `ed25519AgentIdentities` → `createBaseEngine({ agentIdentity })` | the keys, made in memory (`operator.ts`) |
| Every action leaves a record that cannot be rewritten | `HashChainAuditSink`, `verifyAuditChain` | none |
| Every record is signed by the agent that acted | `agentSignatures` of `verifyAuditChain` | none (the operator supplies the public keys) |
| An agent acts only inside a power someone gave it | `mandatePolicy` + `jwtMandateVerifier` of `agent-mandates` | which tool is "an amount" (`amountOf`, 1 line) |
| The power is the agent's, not a string that anyone can use | `issueMandate({ agentIdentity, holderKey })`, `mandatePolicy({ agentIdentity, requireHolderBinding })` | none |
| Above the limit a person decides | `outOfScope: 'ask'` + `approver` | the approver itself (a stand-in for a person) |
| The person who asked cannot approve | `forbidSelfApproval` | none |
| Who the people are and their roles | `approverDirectory` | the table of people (`operator.ts`) |
| The orchestrator hands work over, and each specialist keeps its own identity | `delegatesTo`, `ask_agent`, `Principal.chain` | none |
| What a tool is (reads, changes things) | `defineTool({ readOnly, destructive })` | the tools |
| The numbers | nothing: it is the domain | `domain.ts` (fusion, matrix, rebalance, broker) |

## What the tests prove

Assertions are on the **state of the broker** and on **audit events**, never on text.

- An order inside the executor's power runs with nobody asked, and the event says who, under which power and `holderBinding: proven`.
- Every event of every agent verifies with the operator's keys; editing the log afterwards is detected.
- Above the limit a person of finance approves and the order runs; **the requester cannot approve their own**; with nobody to answer, it does not run. The approval happens *inside a delegated agent*, which is the case that matters.
- A power that is not valid is no power, each for its own reason: a credential **stolen** (signed with another key), issued to **another agent identity**, **absent**, for **another person**, **held by another agent that has the same tool**, and **bearer** (refused when possession is required, accepted but marked `none` when it is not).
- Reading is also under a power: an agent with no credential is denied even a read.

## What the example found in the framework

Building it with only framework primitives (and refusing to write around what was missing) showed:

1. **An order above the limit cannot require a role.** The `ask` that `mandatePolicy` returns for something outside the mandate carries no `approverRoles`, so the engine accepts **any person who is not the requester**: an intern can approve a 6,000 EUR order. The test that states the behaviour we want is written with `it.failing`: the suite is green while the gap exists and goes red the day the framework closes it. *Status: open.*
2. **An approved order outside the mandate leaves a thinner audit record**: the event says who approved but carries no `mandate` and no role. Most likely the same cause as 1: the engine records the authority of an approver only when the `ask` asked for roles (not verified in isolation).
3. *Not a bug, worth knowing:* **delegating is a call like any other**, so the orchestrator needs a power (`ask_agent`) or its delegation is denied and nothing downstream runs. Reads need a power too.

## Where this goes next

The core is this: analyst, rebalancer, executor, orchestrator, power and approval. Planned on top of it, one PR each: the rebalance as a **durable flow** with human approval and resume; the smart money signals through an **MCP server**; the rebalance as a **capability** of `agent-protocol` behind the identity gate; an **evaluation suite** (`agent-testkit`) of the recommendations against the decision matrix.
