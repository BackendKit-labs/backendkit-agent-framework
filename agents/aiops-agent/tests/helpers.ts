import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClassifierAgent, DeciderAgent, type LLMClient } from '../src/agents';
import { openDb, type Db } from '../src/db';
import { Orchestrator } from '../src/orchestrator';
import { CLASSIFIER_SYSTEM } from '../src/prompts';
import { SimilarIncidents, type Embedder } from '../src/similar';
import { createTools } from '../src/tools';

/** Deterministic bag-of-words embedder (64-d hashed) — no Ollama needed. */
export class FakeEmbedder implements Embedder {
    async embed(texts: string[]): Promise<number[][]> {
        return texts.map(t => {
            const v = new Array<number>(64).fill(0);
            for (const w of t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
                if (w.length < 3) continue;
                let h = 0;
                for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
                v[h % 64]! += 1;
            }
            return v;
        });
    }
}

export const jsonOf = (o: unknown): string => JSON.stringify(o);

export interface Script {
    classifier: string[];   // replies in order (last one repeats)
    decider: string[];
}

export function scriptedLLM(script: Script): LLMClient & { calls: { classifier: number; decider: number } } {
    const calls = { classifier: 0, decider: 0 };
    return {
        calls,
        async complete(system: string): Promise<string> {
            const key = system === CLASSIFIER_SYSTEM ? 'classifier' : 'decider';
            const list = script[key];
            const reply = list[Math.min(calls[key], list.length - 1)]!;
            calls[key]++;
            return reply;
        },
    };
}

export function setup(script: Script, embedder: Embedder | null = new FakeEmbedder()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiops-'));
    const logPath = path.join(dir, 'logs', 'decisions.jsonl');
    const db: Db = openDb(':memory:');
    const similar = new SimilarIncidents(db, embedder);
    const tools = createTools({ db, similar });
    const llm = scriptedLLM(script);
    const orch = new Orchestrator({
        db, tools, logPath, classifier: new ClassifierAgent(llm), decider: new DeciderAgent(llm),
    });
    return { db, tools, llm, orch, logPath, similar };
}

export const cls = (o: Record<string, unknown> = {}): string => jsonOf({
    severity: 'critical', category: 'cpu', server: 'prod-01', summary: 'CPU al 99% en prod-01', confidence: 0.9, ...o,
});

export const dec = (o: Record<string, unknown> = {}): string => jsonOf({
    action: 'scale_cpu', toolArgs: { delta_vcpu: 2 },
    justification: [
        'prod-01 reporta cpu=99% con autoscale habilitado (server:prod-01)',
        'P-02 permite scale_cpu y no permite reinicio autónomo en producción (policy:P-02)',
        'INC-014 se resolvió con scale_cpu en un caso equivalente (incident:INC-014)',
    ],
    evidenceRefs: ['server:prod-01', 'policy:P-02', 'incident:INC-014'],
    confidence: 0.85, riskLevel: 'high', ...o,
});

export const readLog = (p: string): Array<Record<string, unknown>> =>
    fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
