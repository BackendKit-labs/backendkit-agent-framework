# @backendkit-labs/agent-mandates

**Mandates for agents:** a power of representation the agent acts under. It says, signed by someone with authority, who the agent works for, what it may do, on what and up to how much. With a valid mandate the agent acts **alone inside its limits**, without asking a person each time; outside them it asks, and without a mandate it does nothing.

**This package is a reference implementation, not a standard of its own and not tied to any identity provider.** `agent-core` knows nothing of any credential format or issuer: it only knows a `Mandate` and a `MandateVerifier`. You can use this verifier, write yours, or put an adapter of a provider in its place; the agent, the policy and the audit do not change. It is the **default verifier**. The contract (`Mandate`, `MandateVerifier`, `mandatePolicy`) lives in `@backendkit-labs/agent-core`; here is a verifier that reads a signed credential in a fixed profile (described below), so agents can work under mandates **now**. The credential of a specific provider (an eIDAS 2 wallet, el sistema compatible con eIDAS 2) is an **adapter** to the same `Mandate`: nothing in your agent changes when it arrives.

The profile below (a JWT shaped like an SD-JWT VC, type `urn:backendkit:mandate:1`) is **our choice**, so the claims of another provider's credential do not match it as they are: that is what an adapter is for. The type is configurable (`vct`).

```bash
npm install @backendkit-labs/agent-mandates @backendkit-labs/agent-core
```

## A complete example

An agent that buys, for Carlos, up to 1000 EUR. The company issues the mandate; the agent runs under it. Runs offline.

```ts
import { generateKeyPairSync } from 'node:crypto';
import { createBaseEngine, defineTool, z, mandatePolicy, MemoryAuditSink, type AgentProfile, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { issueMandate, jwtMandateVerifier } from '@backendkit-labs/agent-mandates';

// 1. Whoever empowers has a key. In production it is the issuer's: you only hold its PUBLIC key.
const company = generateKeyPairSync('ed25519');
const credential = issueMandate({
  privateKey: company.privateKey, alg: 'EdDSA',
  issuer: 'did:example:acme', subject: 'carlos',            // acme empowers; the agent acts for carlos
  agent: 'buyer', actions: ['buy'], limits: { amount: { max: 1000, currency: 'EUR' } },
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

// 2. The tool and the agent.
const buy = defineTool({
  name: 'buy', description: 'Buy an item', destructive: true,
  input: z.object({ item: z.string(), amount: z.number(), currency: z.string() }),
  execute: async ({ item, amount }) => `bought ${item} for ${amount}`,
});
const buyer: AgentProfile = { id: 'buyer', name: 'Buyer', icon: '🛒', description: 'Buys things', systemPrompt: 'Buy what you are asked.', allowedTools: ['buy'] };

// 3. The policy: the mandate decides. Issuers you trust, and where this agent's credential is.
const policy = mandatePolicy({
  verifier: jwtMandateVerifier({
    trustedIssuers: { 'did:example:acme': company.publicKey },
    credentialFor: () => credential,
  }),
  amountOf: args => ({ value: Number(args.amount), currency: String(args.currency) }),   // how to read an amount from a call
});

const audit = new MemoryAuditSink();
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  providers: { mock: scriptedProvider([
    { tool_calls: [{ id: 'c', name: 'buy', args: { item: 'television', amount: 600, currency: 'EUR' } }] },
    { content: 'Done.' },
  ]) },
  defaultProvider: 'mock', agents: [buyer], defaultAgent: 'buyer', tools: [buy],
  transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto',
  identity: { userId: 'carlos' },                           // who the agent acts for: it must match the mandate
  policy, audit,
});

const result = await engine.run('Buy a television');
console.log(result.toolCalls.map(c => `${c.name}:${c.success}`));    // [ 'buy:true' ]   nobody was asked
console.log(audit.events.find(e => e.tool === 'buy')?.mandate);      // { id, issuer: 'did:example:acme', subject: 'carlos', validUntil, evidenceHash }
```

With `amount: 1500` the same agent does not buy: it is outside the mandate, so it asks a person (and with no approver configured, it is refused). Without a credential, or with one signed by someone you do not trust, it does nothing.

## Building the adapter of another identity provider

The credential of a provider (a wallet, an eIDAS 2-compatible service, a corporate directory) is an **adapter** to the same `Mandate`. These are the pieces every adapter needs, so none has to rewrite them:

- **SD-JWT (RFC 9901):** `splitSdJwt`, `resolveDisclosures` (rejects a repeated digest, a Disclosure nobody references and a colliding claim name), `verifyKbJwt` with `kbSigningInput` (key binding: `aud`, `nonce`, `iat`, `sd_hash`) and `hideClaims` (to issue in tests).
- **Format-neutral rules:** the adapter translates its format into a list of powers (`Power`: a verb, an optional object, an optional amount limit) and applies the same rules to all of them: `checkPowers` (**refuses a power with a restriction it cannot enforce**, because ignoring it would grant more than the issuer meant), `selectPower`, `checkAssurance`, `consentMessage` and `checkConsent` (the person's own signature over the powers).

Nothing here knows a provider. Writing an adapter is translating its format into these shapes and returning a `Mandate`.

## What the verifier checks

Each one fails closed, with its own reason:

- a compact JWS with `EdDSA` (Ed25519) or `ES256` (P-256). `none`, the symmetric algorithms and a key of another kind than the algorithm's are refused;
- a header `typ` of `dc+sd-jwt`, `vc+sd-jwt` or `mandate+jwt`, and `vct` equal to `urn:backendkit:mandate:1`;
- an issuer (`iss`) that **you** trust, verified with **that issuer's** keys (a list covers rotation). Nothing is trusted by default;
- `jti` (the id), `sub` (who empowers) and `exp` (an open-ended mandate is not accepted); `nbf` and `exp` against the clock, with a `leewaySeconds` only if you ask;
- the shape of the `mandate` claim: `actions` (tool names, or `*`), optional `agent`, `resources` and `limits.amount`;
- your `isRevoked(mandate)` hook, if any. A hook that throws counts as **revoked**: not being able to check is not "fine".

And in the policy (`mandatePolicy`, from `agent-core`): the mandate is for **this** agent and for the person the agent acts for (`identity.userId`), covers this tool, and the call's amount and resource are inside its limits. A mandate that limits something the policy cannot measure (no `amountOf`) covers nothing.

## The credential profile

The profile this reference verifier reads, a JWT in the shape of an SD-JWT VC:

```json
{ "iss": "did:example:acme", "sub": "carlos", "jti": "m-1", "nbf": 1790000000, "exp": 1790003600,
  "vct": "urn:backendkit:mandate:1",
  "mandate": { "agent": "buyer", "actions": ["buy"], "resources": ["acct-1"], "limits": { "amount": { "max": 1000, "currency": "EUR" } } } }
```

## What it does not do

- **It does not authenticate anyone.** `identity.userId` is what your application says. The mandate says what the agent may do on that person's behalf; that the person is who they claim is for whoever issued it.
- **Measures: a cap that is not money (SPEC-0045, profile 2).** Beyond `limits.amount`, a credential of the profile `urn:backendkit:mandate:2` may carry `limits.measures`: `[{ name: 'rows', max: 100, unit: 'rows' }]`, one maximum **per operation** on any quantity you can read from the call (the rows it deletes, the recipients it writes to). You say how to read each one in `mandatePolicy({ measureOf: { rows: (args) => ({ value: args.ids.length, unit: 'rows' }) } })`; a cap the policy cannot measure leaves the call outside the mandate. `issueMandate({ limits: { measures } })` issues profile 2 by itself, and refuses to put measures in profile 1. **Measures never travel in profile 1:** a verifier that only knows it refuses a profile 2 credential, and the profile 1 rejects a `measures` key, so a cap cannot be accepted and dropped. It needs `agent-core` 0.49.11 or later, which is what checks them (hence the peer range). Counters per period and time windows are not mandate caps: they are the business logic of the operator.
- **A restriction it does not know is refused, not ignored.** The `mandate` claim has `agent`, `agentIdentity`, `actions`, `resources` and `limits` (with `amount`, which has `max` and `currency`). Any other key (a time window, a daily cap, a quantity) makes the credential be refused with the name of the key: ignoring it would grant more than the issuer meant.
- **Tied to the key of the agent (SPEC-0044 F3).** A credential with `cnf` (an Ed25519 key, RFC 7800) is only good for whoever holds that key: the verifier builds a Key Binding JWT for this verification (its `audience`, a fresh nonce, the credential), the agent signs it through the identity provider you hand to `mandatePolicy({ agentIdentity })`, and the verifier checks it. No proof, or a proof by another key, is a refusal; a proven one is recorded `holderBinding: 'proven'`. A credential with no `cnf` is a bearer one: accepted unless you set `requireHolderBinding: true`, and recorded `none`. The mandate can also name the agent identity it is for (`mandate.agentIdentity`); it then covers only the agent whose identity is that one. `issueMandate` takes `holderKey` and `agentIdentity` for tests and demos.
- **Selective disclosure in the reference verifier is not supported yet** (the SD-JWT module above reads it, adapters use it). A credential with disclosures (`jwt~disclosure~...`) is **refused**, not half read.
- **No cumulative limits.** A ceiling is per call. A total ("up to 1000 EUR in the month") needs a state somebody has to keep: see SPEC-0043.
- **It does not decide whom to trust, nor check revocation for you.** The list of issuers and the status source are yours.
- **The wallet protocols** (OpenID4VCI / OpenID4VP) and the format of a specific provider are an adapter, and wait for that provider's format.
- **It does not make anyone compliant.** It supplies controls (a power with limits, traceability, evidence); conformity belongs to the deployment.

Reference: `docs/specs/SPEC-0043-apoderamiento-de-agentes.md`.
