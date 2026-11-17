// A business flow as data: YAML -> runFlow, with a journal, a human approval and a resume. No LLM and no network:
// the executor is scripted, so the example shows the engine and nothing else.
//
//   node examples/flows/run.mjs
//
// Needs the workspace built (`npm run build -w packages/core`) or `@backendkit-labs/agent-core@^0.43.0` installed.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import core from '@backendkit-labs/agent-core';

const {
    loadFlow, runFlow, FileRunJournal, MemoryApprovalStore, createApprovalHandler, stepApprovalId,
} = core;

const here = dirname(fileURLToPath(import.meta.url));
const flow = await loadFlow(join(here, 'close-month.yaml'));

// 1. The executor is the only piece that knows how to run a step: an agent, a remote worker, a queue.
const calls = [];
const executor = {
    async run(step, input) {
        calls.push(step.id);
        return { content: `[${step.agent}] ${input.prompt}` };
    },
};

// 2. Durable state: a run survives the process and can be resumed with the same runId.
const journal = new FileRunJournal(await mkdtemp(join(tmpdir(), 'flows-')));
const approvals = { store: new MemoryApprovalStore() };
const runId = 'close-2026-10';
const options = { executor, journal, approvals, runId, payload: { company: 'Acme', month: '2026-10' } };

// 3. First run: the two collectors run together, `report` stops for a person.
const first = await runFlow(flow, options);
console.log('first run :', first.status, '| ran:', calls.join(', '));

// 4. A person decides. In a real system this is `approval_decide` over HTTP/MCP (see createFlowTools).
const handler = createApprovalHandler(approvals.store);
const approvalId = stepApprovalId(runId, 'report');
console.log('pending   :', (await handler.list({ status: 'pending' })).map(a => a.id));
await handler.decide(approvalId, { decision: 'approve', by: { kind: 'human', id: 'ana' }, reason: 'numbers match' });

// 5. Run again with the same runId: finished steps are not run again; it continues where it stopped.
calls.length = 0;
const second = await runFlow(flow, options);
console.log('second run:', second.status, '| ran:', calls.join(', '));
console.log('report    :', second.steps.report.content);
