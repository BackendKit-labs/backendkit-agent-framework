import { createHash } from 'crypto';
import type { Span } from '@backendkit-labs/agent-core';

export type OtelAttributes = Record<string, string | number | boolean>;

export interface MappedSpan {
    name: string;
    kind: 'internal' | 'client';
    attributes: OtelAttributes;
    /** Set when the span ended in error. */
    errorMessage?: string;
    isError: boolean;
}

/** Deterministic OTel-shaped ids (32 / 16 hex chars) from whatever id format the tracer used. */
export function toTraceId(id: string): string {
    return createHash('sha256').update(`trace:${id}`).digest('hex').slice(0, 32);
}

export function toSpanId(id: string): string {
    return createHash('sha256').update(`span:${id}`).digest('hex').slice(0, 16);
}

const MAX_ERROR_CHARS = 500;

/** `cost_usd` and similar keys keep their meaning under a vendor prefix. */
const VENDOR = 'bk.';

function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Extra tags of the spans agent-core itself produces. The exporter used to copy every tag it had not mapped,
 * so a tag added to core later (a prompt preview, tool arguments) would have been exported silently. Now a tag
 * leaves the process only if it is mapped above or listed here. Spans with any other name come from the
 * application's own tracer calls and keep passing their tags through.
 */
const EXPORTABLE: Record<string, (key: string) => boolean> = {
    run: key => /^guardrail\.[^.]+\.(redact|block|error)$/.test(key),
    agent_block: () => false,
    llm_call: () => false,
    tool_call: key => key === 'success' || key === 'outcome',
};

function rest(tags: Span['tags'], consumed: string[], allow: (key: string) => boolean = () => true): OtelAttributes {
    const out: OtelAttributes = {};
    for (const [k, v] of Object.entries(tags)) {
        if (!consumed.includes(k) && allow(k)) out[`${VENDOR}${k}`] = v;
    }
    return out;
}

/**
 * Translates an agent-core span into OpenTelemetry names and attributes following the GenAI semantic
 * conventions (`invoke_agent`, `chat`, `execute_tool`). Prompts, answers and tool arguments are never
 * part of a span, so nothing here can export conversation content.
 */
export function mapSpan(span: Span): MappedSpan {
    const t = span.tags;
    const isError = span.status === 'error';

    switch (span.name) {
        case 'run': {
            // An error text can be long (and carry whatever the failing code put in it): the span keeps the start.
            const raw = str(t.error);
            const message = raw && raw.length > MAX_ERROR_CHARS ? `${raw.slice(0, MAX_ERROR_CHARS)}…` : raw;
            return {
                name: 'agent.run', kind: 'internal', isError, ...(message ? { errorMessage: message } : {}),
                attributes: { 'bk.trace_id': span.traceId, ...rest(t, ['error'], EXPORTABLE.run) },
            };
        }
        case 'agent_block': {
            const id = str(t.agent_id);
            const name = str(t.agent_name);
            return {
                name: `invoke_agent ${name ?? id ?? 'agent'}`, kind: 'internal', isError,
                attributes: {
                    'gen_ai.operation.name': 'invoke_agent',
                    ...(id ? { 'gen_ai.agent.id': id } : {}),
                    ...(name ? { 'gen_ai.agent.name': name } : {}),
                    ...rest(t, ['agent_id', 'agent_name'], EXPORTABLE.agent_block),
                },
            };
        }
        case 'llm_call': {
            const model = str(t.model);
            const provider = str(t.provider);
            const agent = str(t.agent_id);
            const attributes: OtelAttributes = { 'gen_ai.operation.name': 'chat' };
            if (model) attributes['gen_ai.request.model'] = model;
            if (provider) { attributes['gen_ai.provider.name'] = provider; attributes['gen_ai.system'] = provider; }
            if (agent) attributes['gen_ai.agent.id'] = agent;
            if (typeof t.input_tokens === 'number') attributes['gen_ai.usage.input_tokens'] = t.input_tokens;
            if (typeof t.output_tokens === 'number') attributes['gen_ai.usage.output_tokens'] = t.output_tokens;
            if (typeof t.cache_read_tokens === 'number') attributes['gen_ai.usage.cache_read.input_tokens'] = t.cache_read_tokens;
            if (typeof t.cache_write_tokens === 'number') attributes['gen_ai.usage.cache_creation.input_tokens'] = t.cache_write_tokens;
            if (typeof t.cost_usd === 'number') attributes['bk.cost_usd'] = t.cost_usd;
            if (str(t.purpose)) attributes['bk.llm.purpose'] = String(t.purpose);
            Object.assign(attributes, rest(t, [
                'agent_id', 'provider', 'model', 'input_tokens', 'output_tokens',
                'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'purpose',
            ], EXPORTABLE.llm_call));
            return {
                name: `chat ${model ?? 'unknown'}`, kind: 'client', isError, attributes,
            };
        }
        case 'tool_call': {
            const tool = str(t['tool.name']);
            const agent = str(t.agent_id);
            return {
                name: `execute_tool ${tool ?? 'unknown'}`, kind: 'internal', isError,
                attributes: {
                    'gen_ai.operation.name': 'execute_tool',
                    'gen_ai.tool.type': 'function',
                    ...(tool ? { 'gen_ai.tool.name': tool } : {}),
                    ...(agent ? { 'gen_ai.agent.id': agent } : {}),
                    ...rest(t, ['tool.name', 'agent_id'], EXPORTABLE.tool_call),
                },
            };
        }
        default:
            return { name: span.name, kind: 'internal', isError, attributes: rest(t, []) };
    }
}
