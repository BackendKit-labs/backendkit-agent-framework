# portfolio-advisor

A portfolio advisor made of four agents over a **simulated market and a simulated broker**. It is not advice and it trades nothing real. It exists to put a realistic job under the governance of the framework and see what holds: identity of each agent, a signed audit, a power (mandate) with proof of possession, approval by role with four eyes, and delegation.

It runs with **no key and no network**: a scripted model plays the LLM, so the tests check what the framework lets through and not what a model happens to say.

```bash
npm install
npm test          # 31 tests, offline
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
| A process that survives a restart and stops for a person | `parseFlow`, `runFlow`, `NdjsonRunJournal`, `FileApprovalStore`, `createApprovalHandler`, `gate: { approval: human }` | the flow definition (data) and a 10-line `StepExecutor` that runs the agent a step names (`flow.ts`) |
| The numbers | nothing: it is the domain | `domain.ts` (fusion, matrix, rebalance, broker) |

## What the tests prove

Assertions are on the **state of the broker** and on **audit events**, never on text.

- An order inside the executor's power runs with nobody asked, and the event says who, under which power and `holderBinding: proven`.
- Every event of every agent verifies with the operator's keys; editing the log afterwards is detected.
- Above the limit a person of finance approves and the order runs; **the requester cannot approve their own**; with nobody to answer, it does not run. The approval happens *inside a delegated agent*, which is the case that matters.
- A power that is not valid is no power, each for its own reason: a credential **stolen** (signed with another key), issued to **another agent identity**, **absent**, for **another person**, **held by another agent that has the same tool**, and **bearer** (refused when possession is required, accepted but marked `none` when it is not).
- Reading is also under a power: an agent with no credential is denied even a read.

### The rebalance as a flow (`flow.ts`, `flow.test.ts`)

Two steps: the rebalancer plans, a person looks at the plan, the executor sends. A "restart" in the tests is a new advisor (engine, journal object and approval store) over the same directory.

- It stops as `awaiting_approval` after the plan and **nothing is sent** until a person decides; with no decision, running it again changes nothing.
- After a restart and the decision it goes on **without planning again** (the plan was computed once), sends the order, and the audit of the two processes is **one chain** where every event verifies with the operator's keys.
- Approving the plan is **not** approving every order: an order above the executor's limit asks again at the engine.
- A rejected plan sends nothing and the executor never runs.

## What the example found in the framework

Building it with only framework primitives (and refusing to write around what was missing) showed:

1. `CLOSED, agent-core 0.49.7` **An order above the limit could not require a role.** The `ask` that `mandatePolicy` returned for something outside the mandate carried no `approverRoles`, so the engine accepted **any person who was not the requester**: an intern could approve a 6,000 EUR order. The example found it with a test, the framework got `outOfScopeApprover: { approverRoles }`, and the example now uses it: the intern, the requester and an unknown person are refused, and the audit of an approved order carries the role that matched (`authority: { roles, matched }`).
2. *Still thin, minor:* the audit event of an order approved outside the mandate does not carry the `mandate` it was outside of, only who approved. Whether it should is a question for the framework, not decided.
3. **A flow gate cannot require a role or four eyes.** The approval of a step of a flow carries `reason`, `approver` and `accepts` from the policy's `ask` and nothing else: not its `approverRoles`, and the flow neither consults an `approverDirectory` nor applies `forbidSelfApproval` as the engine does. So an intern, or the person who asked for the rebalance, can approve the plan. Two `it.failing` tests state what we want. *Status: open.*
4. *Not a bug, worth knowing:* **delegating is a call like any other**, so the orchestrator needs a power (`ask_agent`) or its delegation is denied and nothing downstream runs. Reads need a power too.

## Where this goes next

Built: the core (analyst, rebalancer, executor, orchestrator, power and approval) and the durable flow. Planned, one PR each: the smart money signals through an **MCP server**; the rebalance as a **capability** of `agent-protocol` behind the identity gate; an **evaluation suite** (`agent-testkit`) of the recommendations against the decision matrix.
