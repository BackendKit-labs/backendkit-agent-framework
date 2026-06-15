'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, X, GripVertical } from 'lucide-react';
import {
    cn, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button,
} from '@/components/ui';
import type { FlowConfig, FlowStep, AgentConfig } from '@/lib/gateway';

// ── Defaults ──────────────────────────────────────────────────────────────────

const EMPTY_FLOW: FlowConfig = {
    id: '', name: '', description: '', trigger: '', steps: [], file: '',
};

function newStep(position: number): FlowStep {
    return { id: `step-${position + 1}`, agent: '', task: '', depends_on: [], gate: false, require: false };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('space-y-1', className)}>
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

function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className={cn(
                'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm resize-none',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                className,
            )}
        />
    );
}

// ── StepEditor ────────────────────────────────────────────────────────────────

interface StepEditorProps {
    step:        FlowStep;
    index:       number;
    total:       number;
    allStepIds:  string[];
    agentIds:    string[];
    onChange:    (step: FlowStep) => void;
    onRemove:    () => void;
    onMoveUp:    () => void;
    onMoveDown:  () => void;
}

function StepEditor({ step, index, total, allStepIds, agentIds, onChange, onRemove, onMoveUp, onMoveDown }: StepEditorProps) {
    const [expanded, setExpanded] = useState(index === 0);
    const prevStepIds = allStepIds.slice(0, index);

    function set<K extends keyof FlowStep>(key: K, val: FlowStep[K]) {
        onChange({ ...step, [key]: val });
    }

    function toggleDepend(id: string) {
        const deps = step.depends_on ?? [];
        set('depends_on', deps.includes(id) ? deps.filter(d => d !== id) : [...deps, id]);
    }

    function setCriterion(i: number, val: string) {
        const gate_criteria = [...(step.gate_criteria ?? [])];
        gate_criteria[i] = val;
        set('gate_criteria', gate_criteria);
    }

    return (
        <div className={cn(
            'rounded-lg border bg-card',
            step.gate ? 'border-amber-700/40' : 'border-border',
        )}>
            {/* Step header */}
            <div className="flex items-center gap-2 px-3 py-2">
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />
                <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">#{index + 1}</span>
                <span className="text-sm font-medium flex-1 truncate">{step.id || `(unnamed step)`}</span>
                {step.agent && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">{step.agent}</span>
                )}
                {step.gate && (
                    <span className="text-[10px] rounded bg-amber-950/40 border border-amber-700/30 px-1 text-amber-400">gate</span>
                )}
                {step.require && (
                    <span className="text-[10px] rounded bg-orange-950/40 border border-orange-700/30 px-1 text-orange-400">required</span>
                )}
                <div className="flex gap-0.5">
                    <button onClick={onMoveUp}   disabled={index === 0}         className="p-1 text-muted-foreground/40 hover:text-foreground disabled:opacity-20"><ChevronUp   className="h-3.5 w-3.5" /></button>
                    <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-muted-foreground/40 hover:text-foreground disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setExpanded(e => !e)} className="p-1 text-muted-foreground/40 hover:text-foreground">
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={onRemove} className="p-1 text-muted-foreground/40 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                </div>
            </div>

            {expanded && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Step ID *">
                            <Input value={step.id} onChange={e => set('id', e.target.value)} placeholder="classify" />
                        </Field>
                        <Field label="Agent *">
                            {agentIds.length > 0 ? (
                                <select
                                    value={step.agent}
                                    onChange={e => set('agent', e.target.value)}
                                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">— choose agent —</option>
                                    {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
                                </select>
                            ) : (
                                <Input value={step.agent} onChange={e => set('agent', e.target.value)} placeholder="triage" />
                            )}
                        </Field>
                    </div>

                    <Field label="Task prompt *">
                        <Textarea
                            value={step.task}
                            onChange={e => set('task', e.target.value)}
                            placeholder="Describe what this agent should do. Use {{payload.field}} and {{steps.step-id.output}}"
                            rows={4}
                        />
                    </Field>

                    <Field label="Capability (optional)">
                        <Input value={step.capability ?? ''} onChange={e => set('capability', e.target.value || undefined)} placeholder="execute" />
                    </Field>

                    {/* depends_on — only show if there are previous steps */}
                    {prevStepIds.length > 0 && (
                        <Field label="Depends on">
                            <div className="flex flex-wrap gap-2">
                                {prevStepIds.map(id => (
                                    <label key={id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={(step.depends_on ?? []).includes(id)}
                                            onChange={() => toggleDepend(id)}
                                            className="h-3.5 w-3.5"
                                        />
                                        <span className="font-mono">{id}</span>
                                    </label>
                                ))}
                            </div>
                        </Field>
                    )}

                    {/* Gate + Required toggles */}
                    <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={step.gate ?? false}
                                onChange={e => set('gate', e.target.checked)}
                                className="h-4 w-4"
                            />
                            <span>Gate (pause for approval)</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={step.require ?? false}
                                onChange={e => set('require', e.target.checked)}
                                className="h-4 w-4"
                            />
                            <span>Required (retry on failure)</span>
                        </label>
                    </div>

                    {/* Gate criteria */}
                    {step.gate && (
                        <Field label="Gate criteria">
                            <div className="space-y-2">
                                {(step.gate_criteria ?? []).map((c, i) => (
                                    <div key={i} className="flex gap-2">
                                        <Input value={c} onChange={e => setCriterion(i, e.target.value)} placeholder="Criterion..." className="flex-1" />
                                        <button
                                            onClick={() => set('gate_criteria', (step.gate_criteria ?? []).filter((_, idx) => idx !== i))}
                                            className="text-muted-foreground hover:text-red-400"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => set('gate_criteria', [...(step.gate_criteria ?? []), ''])}
                                    className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary"
                                >
                                    <Plus className="h-3.5 w-3.5" /> Add criterion
                                </button>
                            </div>
                        </Field>
                    )}
                </div>
            )}
        </div>
    );
}

// ── FlowFormDialog ────────────────────────────────────────────────────────────

interface FlowFormDialogProps {
    open:        boolean;
    onClose:     () => void;
    initial?:    FlowConfig;
    agentIds:    string[];
    onSave:      (flow: FlowConfig) => Promise<void>;
}

export function FlowFormDialog({ open, onClose, initial, agentIds, onSave }: FlowFormDialogProps) {
    const [form,  setForm]  = useState<FlowConfig>(initial ?? EMPTY_FLOW);
    const [busy,  setBusy]  = useState(false);
    const [error, setError] = useState('');

    const isNew = !initial;

    useEffect(() => {
        if (open) { setForm(initial ?? EMPTY_FLOW); setError(''); }
    }, [open, initial]);

    function setField<K extends keyof FlowConfig>(key: K, val: FlowConfig[K]) {
        setForm(f => ({ ...f, [key]: val }));
    }

    function setStep(i: number, step: FlowStep) {
        setForm(f => { const steps = [...f.steps]; steps[i] = step; return { ...f, steps }; });
    }

    function addStep() {
        setForm(f => ({ ...f, steps: [...f.steps, newStep(f.steps.length)] }));
    }

    function removeStep(i: number) {
        setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));
    }

    function moveStep(i: number, dir: -1 | 1) {
        setForm(f => {
            const steps = [...f.steps];
            const j = i + dir;
            [steps[i], steps[j]] = [steps[j], steps[i]];
            return { ...f, steps };
        });
    }

    async function handleSave() {
        if (!form.id.trim())         return setError('Flow ID is required');
        if (!(form.name ?? '').trim()) return setError('Flow name is required');
        if (!form.steps.length) return setError('Add at least one step');
        const emptyAgent = form.steps.find(s => !s.agent.trim());
        if (emptyAgent) return setError(`Step "${emptyAgent.id}": agent is required`);
        const emptyTask = form.steps.find(s => !s.task.trim());
        if (emptyTask)  return setError(`Step "${emptyTask.id}": task is required`);

        setBusy(true); setError('');
        try {
            await onSave({ ...form, trigger: form.trigger || '', description: form.description || '' });
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally { setBusy(false); }
    }

    const allStepIds = form.steps.map(s => s.id);

    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isNew ? 'New Flow' : `Edit Flow — ${initial?.id}`}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* Identity */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Flow ID *">
                            <input
                                value={form.id}
                                onChange={e => setField('id', e.target.value)}
                                placeholder="knowledge-search"
                                disabled={!isNew}
                                className={cn(
                                    'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm',
                                    'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                    !isNew && 'opacity-60 cursor-not-allowed',
                                )}
                            />
                        </Field>
                        <Field label="Name *">
                            <input
                                value={form.name}
                                onChange={e => setField('name', e.target.value)}
                                placeholder="Knowledge Search"
                                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                        </Field>
                    </div>

                    <Field label="Description">
                        <input
                            value={form.description ?? ''}
                            onChange={e => setField('description', e.target.value)}
                            placeholder="What this flow does"
                            className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </Field>

                    <Field label="Trigger (regex for auto-routing via run_task)">
                        <input
                            value={form.trigger ?? ''}
                            onChange={e => setField('trigger', e.target.value)}
                            placeholder="buscar|search|how|what"
                            className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </Field>

                    {/* Step pipeline */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                                Steps ({form.steps.length})
                            </span>
                            <button
                                onClick={addStep}
                                className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add step
                            </button>
                        </div>

                        {form.steps.length === 0 && (
                            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                                No steps yet. Add at least one step to define the pipeline.
                            </div>
                        )}

                        <div className="space-y-2">
                            {form.steps.map((step, i) => (
                                <StepEditor
                                    key={i}
                                    step={step}
                                    index={i}
                                    total={form.steps.length}
                                    allStepIds={allStepIds}
                                    agentIds={agentIds}
                                    onChange={s => setStep(i, s)}
                                    onRemove={() => removeStep(i)}
                                    onMoveUp={() => moveStep(i, -1)}
                                    onMoveDown={() => moveStep(i, 1)}
                                />
                            ))}
                        </div>
                    </div>

                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button size="sm" onClick={handleSave} disabled={busy}>
                        {busy ? 'Saving…' : isNew ? 'Create flow' : 'Save changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
