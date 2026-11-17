import type { FlowCondition } from './types';

/** Text of a condition for the log: `decision contains "ENTER"`. */
export function describeCondition(c: FlowCondition): string {
    if (c.contains !== undefined) return `${c.step} ${c.not ? 'does not contain' : 'contains'} "${c.contains}"`;
    if (c.equals !== undefined) return `${c.step} ${c.not ? 'does not equal' : 'equals'} "${c.equals}"`;
    return `${c.step} ${c.not ? 'does not match' : 'matches'} /${c.matches}/`;
}

/** Whether `output` (of the step the condition looks at) satisfies it. An invalid regular expression is never satisfied: `validateFlow` reports it. */
export function evaluateCondition(c: FlowCondition, output: string): boolean {
    let ok: boolean;
    if (c.contains !== undefined) ok = output.includes(c.contains);
    else if (c.equals !== undefined) ok = output.trim() === c.equals.trim();
    else {
        try { ok = new RegExp(c.matches ?? '').test(output); } catch { return false; }
    }
    return c.not ? !ok : ok;
}
