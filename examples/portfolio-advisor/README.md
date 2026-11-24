# portfolio-advisor

A portfolio advisor made of four agents over a **simulated market and a simulated broker**. It is not advice and it trades nothing real. It exists to put a realistic job under the governance of the framework and see what holds: identity of each agent, a signed audit, a power (mandate) with proof of possession, approval by role with four eyes, and delegation.

It runs with **no key and no network**: a scripted model plays the LLM, so the tests check what the framework lets through and not what a model happens to say.

```bash
npm install
npm test          # 38 tests, offline
```

The domain (what the agents are *about*) follows the design of a finance portfolio system: the decision matrix (§6), the default weights (§8.3) and the conflict rules (§8.5) of its `design.md`. Nothing in the numbers is invented.

## The agents

| Agent | Tools | Power it holds |
|---|---|---|
| `analyst` | `get_portfolio`, `get_signal` | none: reading is not critical |
| `rebalancer` | `get_portfolio`, `plan_rebalance` | none: planning sends nothing |
| `executor` | `place_order` (destructive) | trade, up to **5,000 EUR and 100 shares per order** |
| `orchestrator` | none; `delegatesTo` the three | none: delegating changes nothing by itself |

**Only what is critical holds a mandate** (SPEC-0045): an order cannot be undone, so the executor sends one alone only inside its power; reading, planning and handing work over are decided by the framework's own policy (a read runs). The mandate caps two things, one of them **not money**: the amount (`limits.amount`) and the shares an order moves (`limits.measures`, which the example reads with `measureOf`).

## What is framework and what is the example's own code

The point of the example is that **what governs the agents is framework**. This table is the contract: each requirement, what implements it, and the code the example had to write itself.

| Requirement | Framework primitive | The example's own code |
|---|---|---|
| Each agent is someone, not "the advisor" | `ed25519AgentIdentities` → `createBaseEngine({ agentIdentity })` | the keys, made in memory (`operator.ts`) |
| Every action leaves a record that cannot be rewritten | `HashChainAuditSink`, `verifyAuditChain` | none |
| Every record is signed by the agent that acted | `agentSignatures` of `verifyAuditChain` | none (the operator supplies the public keys) |
| An agent acts only inside a power someone gave it | `mandatePolicy` + `jwtMandateVerifier` of `agent-mandates` | which tool is "an amount" (`amountOf`) and "a number of shares" (`measureOf`), one line each |
| A power only for what is critical | `mandatePolicy({ appliesTo })`; the rest by the framework's own policy (`otherwise`) | the predicate: `tool.destructive === true` |
| A cap that is not money | `limits.measures` (profile 2 of the credential) + `measureOf` | none |
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
- **Only what is critical holds a power.** The analyst reads, the rebalancer plans and the orchestrator hands work over with **no credential at all** and the audit shows no mandate on them; with no credential for the executor it cannot trade while the others still read.
- **A cap that is not money.** An order of 150 shares costs 3,000 EUR, inside the 5,000 EUR the executor may send alone, and still asks a person because it is above the 100 shares of its mandate. The audit says which power it went beyond (`exceeded`, never `mandate`), the same approval rules apply (an intern does not approve it), and a mandate issued without that cap lets it through: the cap is the credential, not the code.

### The rebalance as a flow (`flow.ts`, `flow.test.ts`)

Two steps: the rebalancer plans, a person looks at the plan, the executor sends. A "restart" in the tests is a new advisor (engine, journal object and approval store) over the same directory.

- It stops as `awaiting_approval` after the plan and **nothing is sent** until a person decides; with no decision, running it again changes nothing.
- After a restart and the decision it goes on **without planning again** (the plan was computed once), sends the order, and the audit of the two processes is **one chain** where every event verifies with the operator's keys.
- Approving the plan is **not** approving every order: an order above the executor's limit asks again at the engine.
- A rejected plan sends nothing and the executor never runs.
- **Who may approve the plan is a person of finance who did not ask for it**, with the same two primitives as an order: the policy asks for the step (`flow.step:execute`) with `approverRoles: ['finance']`, and `approverDirectory` plus `forbidSelfApproval` on the flow and on the handler a supervisor decides through. An intern and the requester are refused by the handler (`FORBIDDEN`) and the plan stays open for someone who may decide it; and a decision written straight into the store by something that checked nothing is refused by the flow when it goes on.

## What the example found in the framework

Building it with only framework primitives (and refusing to write around what was missing) showed:

All three were found by a test written against what we wanted, and closed in the framework; none was worked around in the example.

1. `CLOSED, agent-core 0.49.7` **An order above the limit could not require a role.** The `ask` that `mandatePolicy` returned for something outside the mandate carried no `approverRoles`, so the engine accepted **any person who was not the requester**: an intern could approve a 6,000 EUR order. The framework got `outOfScopeApprover: { approverRoles }`, and the example uses it.
2. `CLOSED, agent-core 0.49.8` **The record of an order approved outside the mandate said who approved but not why a person was asked, nor which power it went beyond.** Now the event carries `reason` and `exceeded` (the mandate, never recorded as `mandate`, which means "covered"), and the test checks it.
3. `CLOSED, agent-core 0.49.9` **A flow gate, the approval handler and the direct tool server did not enforce roles or four eyes**: an intern, or the person who asked, could approve the plan. The check lived in three copies and had drifted; it is now one function (`checkApproval`) used by the engine, the flow, the handler and the tool server, with a conformance test that runs the same five scenarios through all of them. The event also keeps the reason the approver gave (`approval.reason`).
4. `CLOSED, SPEC-0045` **A mandate was asked for on every call, even to read and to delegate**, so the analyst, the rebalancer and the orchestrator needed one only to exist, and the default policy could not stand next to the mandate (it asks for every destructive tool, and an `ask` beats an `allow`). `appliesTo` and `otherwise` (agent-core 0.49.11) say what the mandate is for; the three agents lost their credentials.

## Where this goes next

Built: the core (analyst, rebalancer, executor, orchestrator, power and approval) and the durable flow. Planned, one PR each: the smart money signals through an **MCP server**; the rebalance as a **capability** of `agent-protocol` behind the identity gate; an **evaluation suite** (`agent-testkit`) of the recommendations against the decision matrix.
