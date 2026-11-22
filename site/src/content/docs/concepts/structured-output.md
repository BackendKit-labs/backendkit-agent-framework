---
title: Structured output
description: Ask a model for typed data instead of text, with validation and a retry that tells the model what was wrong.
---

Sometimes you do not want a conversation, you want **data**: an invoice read from an email, a ticket classified, a plan as a list of steps. `generateObject` asks a model for an object that matches a [zod](https://zod.dev) schema and returns it already typed. It is one call, with no agent loop and no tools.

## A complete example

One file. It runs **offline**: a scripted model plays two answers, the first one invalid, so you see the retry. Save it as `invoice.ts` and run it with `npx tsx invoice.ts`.

```bash
npm install @backendkit-labs/agent-core
npm install -D @backendkit-labs/agent-testkit typescript tsx
```

```ts
import { generateObject, z } from '@backendkit-labs/agent-core';
import { scriptedProvider } from '@backendkit-labs/agent-testkit';

const Invoice = z.object({
  number: z.string(),
  total: z.number(),
  currency: z.enum(['EUR', 'USD']),
});

// Offline: the first answer is wrong (total is a string), the second is right.
const provider = scriptedProvider([
  { content: 'Sure! {"number": "F-2026-014", "total": "1200", "currency": "EUR"}' },
  { content: '```json\n{"number": "F-2026-014", "total": 1200, "currency": "EUR"}\n```' },
]);

const invoice = await generateObject(provider, 'Extract the invoice: F-2026-014, 1200 EUR', Invoice);
console.log(invoice);                    // { number: 'F-2026-014', total: 1200, currency: 'EUR' }
console.log(provider.calls.length);      // 2: the second call carried the correction
```

With a real model, replace `scriptedProvider(...)` with your provider (`new OpenAICompatibleProvider(...)`, `new AnthropicProvider(...)`). Nothing else changes.

## What it does

1. Turns the schema into a JSON Schema and sends it with the prompt. If the provider **enforces** schemas itself (`capabilities.structuredOutput === 'native'`), the prompt is sent as it is; otherwise the schema is added to the prompt ("Respond with JSON only, matching this JSON Schema").
2. Reads the answer as JSON. It tolerates what models do anyway: a Markdown fence around the object, or a sentence before and after it.
3. Validates it with the schema. If it is valid, you get the typed object.
4. If it is not valid, it **asks again**, once by default, telling the model what was wrong (`total: expected number, received string`).
5. If it is still not valid, it throws `StructuredOutputError`.

Provider failures (network, rate limit, an error from the API) are rethrown as they are: they are not "an invalid answer".

## When it fails

```ts
import { generateObject, StructuredOutputError } from '@backendkit-labs/agent-core';

try {
  await generateObject(provider, prompt, Invoice, { retries: 2 });
} catch (err) {
  if (err instanceof StructuredOutputError) {
    console.error(err.message);   // "Model did not return a valid object after 3 attempt(s): total: ..."
    console.error(err.raw);       // the last text the model wrote
    console.error(err.issues);    // zod issues, or the JSON parse error
  }
}
```

Decide what a failure means for your program. Do not use the half-parsed text: `raw` is for a log, not for a guess.

## Options

| Option | Default | What |
|---|---|---|
| `retries` | `1` | Extra attempts after an invalid answer. `0` asks once. |
| `model` | the provider's | Use another model for this call. |
| `system` | none | A system message for the call. |
| `name` | `response` | Name of the schema, for providers that need one. |
| `signal` | none | An `AbortSignal` to cancel. |
| `onMetrics` | none | Receives the token usage of **every** attempt, so a retry shows in your cost. |

## Not a provider? `generateObjectWith`

`generateObjectWith(chat, prompt, schema, opts, capability?)` is the same thing over any function `(messages, options) => Promise<string>`. Use it when your model is behind your own client or a wrapper (a retrying client, a proxy). `capability` tells it how firmly that backend enforces the schema: pass `'native'` only if it does.

## Choosing between this and an agent

| You want | Use |
|---|---|
| One answer in a known shape (extract, classify, summarise into fields) | `generateObject` |
| A model that decides what to look up and do, over several steps | an engine with [tools](../engine-and-tools/) |
| A planned sequence of steps with approvals | a [flow](../flows/) |

Inside an engine you can still use it: call `generateObject` from a tool's `execute` to turn a model's free text into data your code can trust.
