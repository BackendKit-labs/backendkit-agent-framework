'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
    cn, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button,
} from '@/components/ui';
import type { AgentConfig } from '@/lib/gateway';

// ── Defaults ──────────────────────────────────────────────────────────────────

const EMPTY_AGENT: AgentConfig = {
    id: '', description: '', strategy: 'round-robin', capability: 'execute',
    gate: false, instances: [{ url: '' }],
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            {children}
        </div>
    );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={cn(
                'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                className,
            )}
        />
    );
}

function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className={cn(
                'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                className,
            )}
        />
    );
}

// ── AgentFormDialog ───────────────────────────────────────────────────────────

interface AgentFormDialogProps {
    open:     boolean;
    onClose:  () => void;
    initial?: AgentConfig;
    onSave:   (agent: AgentConfig) => Promise<void>;
}

export function AgentFormDialog({ open, onClose, initial, onSave }: AgentFormDialogProps) {
    const [form,  setForm]  = useState<AgentConfig>(initial ?? EMPTY_AGENT);
    const [busy,  setBusy]  = useState(false);
    const [error, setError] = useState('');

    const isNew = !initial;

    useEffect(() => {
        if (open) { setForm(initial ?? EMPTY_AGENT); setError(''); }
    }, [open, initial]);

    function set<K extends keyof AgentConfig>(key: K, val: AgentConfig[K]) {
        setForm(f => ({ ...f, [key]: val }));
    }

    function setInstance(i: number, field: 'url' | 'apiKey', val: string) {
        setForm(f => {
            const instances = [...(f.instances ?? [])];
            instances[i] = { ...instances[i], [field]: val };
            return { ...f, instances };
        });
    }

    function addInstance() {
        setForm(f => ({ ...f, instances: [...(f.instances ?? []), { url: '' }] }));
    }

    function removeInstance(i: number) {
        setForm(f => ({ ...f, instances: (f.instances ?? []).filter((_, idx) => idx !== i) }));
    }

    function setCriteria(i: number, val: string) {
        setForm(f => {
            const gate_criteria = [...(f.gate_criteria ?? [])];
            gate_criteria[i] = val;
            return { ...f, gate_criteria };
        });
    }

    function addCriterion() {
        setForm(f => ({ ...f, gate_criteria: [...(f.gate_criteria ?? []), ''] }));
    }

    function removeCriterion(i: number) {
        setForm(f => ({ ...f, gate_criteria: (f.gate_criteria ?? []).filter((_, idx) => idx !== i) }));
    }

    async function handleSave() {
        if (!form.id.trim())                   return setError('ID is required');
        if (!(form.instances ?? []).length)    return setError('At least one instance URL is required');
        if (!(form.instances ?? []).every(i => i.url.trim())) return setError('All instance URLs must be filled');
        setBusy(true); setError('');
        try {
            await onSave({
                ...form,
                gate_criteria: form.gate ? (form.gate_criteria ?? []).filter(Boolean) : undefined,
            });
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally { setBusy(false); }
    }

    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isNew ? 'New Agent' : `Edit Agent — ${initial?.id}`}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* ID + Description */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="ID *">
                            <Input
                                value={form.id}
                                onChange={e => set('id', e.target.value)}
                                placeholder="triage"
                                disabled={!isNew}
                            />
                        </Field>
                        <Field label="Description">
                            <Input
                                value={form.description ?? ''}
                                onChange={e => set('description', e.target.value)}
                                placeholder="What this agent does"
                            />
                        </Field>
                    </div>

                    {/* Strategy + Capability */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Strategy">
                            <Select value={form.strategy} onChange={e => set('strategy', e.target.value as AgentConfig['strategy'])}>
                                <option value="round-robin">round-robin</option>
                                <option value="least-busy">least-busy</option>
                                <option value="random">random</option>
                                <option value="failover">failover</option>
                            </Select>
                        </Field>
                        <Field label="Capability">
                            <Input
                                value={form.capability ?? 'execute'}
                                onChange={e => set('capability', e.target.value)}
                                placeholder="execute"
                            />
                        </Field>
                    </div>

                    {/* Timeout */}
                    <Field label="Timeout (ms)">
                        <Input
                            type="number"
                            value={form.timeout ?? ''}
                            onChange={e => set('timeout', e.target.value ? Number(e.target.value) : undefined)}
                            placeholder="30000 (default)"
                        />
                    </Field>

                    {/* Instances */}
                    <Field label="Instances *">
                        <div className="space-y-2">
                            {(form.instances ?? []).map((inst, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input
                                        value={inst.url}
                                        onChange={e => setInstance(i, 'url', e.target.value)}
                                        placeholder="http://localhost:3301"
                                        className="flex-1"
                                    />
                                    <Input
                                        value={inst.apiKey ?? ''}
                                        onChange={e => setInstance(i, 'apiKey', e.target.value)}
                                        placeholder="API key (optional)"
                                        className="w-36"
                                    />
                                    {(form.instances ?? []).length > 1 && (
                                        <button
                                            onClick={() => removeInstance(i)}
                                            className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                onClick={addInstance}
                                className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add instance
                            </button>
                        </div>
                    </Field>

                    {/* Gate */}
                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="agent-gate"
                            checked={form.gate ?? false}
                            onChange={e => set('gate', e.target.checked)}
                            className="h-4 w-4 rounded border-input"
                        />
                        <label htmlFor="agent-gate" className="text-sm">
                            Gate — pause flow for human approval after this agent runs
                        </label>
                    </div>

                    {/* Gate criteria (only when gate is on) */}
                    {form.gate && (
                        <Field label="Gate criteria">
                            <div className="space-y-2">
                                {(form.gate_criteria ?? []).map((c, i) => (
                                    <div key={i} className="flex gap-2">
                                        <Input
                                            value={c}
                                            onChange={e => setCriteria(i, e.target.value)}
                                            placeholder="Criterion..."
                                            className="flex-1"
                                        />
                                        <button onClick={() => removeCriterion(i)} className="text-muted-foreground hover:text-red-400">
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={addCriterion}
                                    className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors"
                                >
                                    <Plus className="h-3.5 w-3.5" /> Add criterion
                                </button>
                            </div>
                        </Field>
                    )}

                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button size="sm" onClick={handleSave} disabled={busy}>
                        {busy ? 'Saving…' : isNew ? 'Create agent' : 'Save changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
