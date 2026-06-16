'use client';

import { useState } from 'react';
import {
    Box, Plus, Trash2, RefreshCw, ExternalLink,
    Container, Cpu, MemoryStick, KeyRound, Tag,
} from 'lucide-react';
import {
    cn, Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui';
import type { DeployedInstance, DeploySpec } from '@/lib/gateway';
import { deployAgent, undeployAgent, listDeployments } from '@/lib/gateway';

// ── Helpers ────────────────────────────────────────────────────────────────────

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
                'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                className,
            )}
        />
    );
}

function StatusBadge({ status }: { status: string }) {
    const running = status === 'running';
    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            running
                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-700/30'
                : 'bg-red-950/40 text-red-400 border border-red-700/30',
        )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-400' : 'bg-red-400')} />
            {status}
        </span>
    );
}

// ── Deploy Form Dialog ─────────────────────────────────────────────────────────

const EMPTY_SPEC: DeploySpec = {
    id: '', image: '', containerPort: 8080, description: '',
    capability: 'execute', strategy: 'round-robin',
    env: {}, memoryMb: undefined, cpus: undefined, apiKey: '',
};

interface EnvEntry { key: string; value: string; }

function DeployFormDialog({
    open, onClose, onDeployed,
}: {
    open:       boolean;
    onClose:    () => void;
    onDeployed: (inst: DeployedInstance) => void;
}) {
    const [spec,    setSpec]    = useState<DeploySpec>(EMPTY_SPEC);
    const [envRows, setEnvRows] = useState<EnvEntry[]>([]);
    const [busy,    setBusy]    = useState(false);
    const [log,     setLog]     = useState('');
    const [error,   setError]   = useState('');

    function reset() {
        setSpec(EMPTY_SPEC);
        setEnvRows([]);
        setError('');
        setLog('');
    }

    function set<K extends keyof DeploySpec>(k: K, v: DeploySpec[K]) {
        setSpec(s => ({ ...s, [k]: v }));
    }

    function addEnvRow()  { setEnvRows(r => [...r, { key: '', value: '' }]); }
    function removeEnvRow(i: number) { setEnvRows(r => r.filter((_, idx) => idx !== i)); }
    function setEnvRow(i: number, field: 'key' | 'value', val: string) {
        setEnvRows(r => { const next = [...r]; next[i] = { ...next[i], [field]: val }; return next; });
    }

    async function handleDeploy() {
        if (!spec.id.trim())    return setError('Agent ID is required');
        if (!spec.image.trim()) return setError('Image is required');

        const env: Record<string, string> = {};
        for (const { key, value } of envRows) {
            if (key.trim()) env[key.trim()] = value;
        }

        setBusy(true);
        setError('');
        setLog('Pulling image and starting container… this may take a moment.');

        try {
            const result = await deployAgent({ ...spec, env: Object.keys(env).length ? env : undefined });
            if (!result.ok || result.error) {
                setError(result.error ?? 'Deploy failed');
                return;
            }
            onDeployed({
                instanceId: result.instanceId!,
                agentId:    result.agentId!,
                image:      spec.image,
                url:        result.url!,
                status:     'running',
                createdAt:  new Date().toISOString(),
            });
            reset();
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
            setLog('');
        }
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v && !busy) { reset(); onClose(); } }}>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Container className="h-4 w-4 text-primary" />
                        Deploy Agent Container
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* Identity */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Agent ID *">
                            <Input
                                value={spec.id}
                                onChange={e => set('id', e.target.value)}
                                placeholder="my-agent"
                            />
                        </Field>
                        <Field label="Docker Image *">
                            <Input
                                value={spec.image}
                                onChange={e => set('image', e.target.value)}
                                placeholder="myregistry/agent:latest"
                            />
                        </Field>
                    </div>

                    <Field label="Description">
                        <Input
                            value={spec.description ?? ''}
                            onChange={e => set('description', e.target.value)}
                            placeholder="What this agent does"
                            className="font-sans"
                        />
                    </Field>

                    {/* Runtime config */}
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Container port">
                            <Input
                                type="number"
                                value={spec.containerPort ?? 8080}
                                onChange={e => set('containerPort', Number(e.target.value))}
                                placeholder="8080"
                            />
                        </Field>
                        <Field label="Memory (MB)">
                            <Input
                                type="number"
                                value={spec.memoryMb ?? ''}
                                onChange={e => set('memoryMb', e.target.value ? Number(e.target.value) : undefined)}
                                placeholder="256"
                            />
                        </Field>
                        <Field label="CPUs">
                            <Input
                                type="number"
                                step="0.1"
                                value={spec.cpus ?? ''}
                                onChange={e => set('cpus', e.target.value ? Number(e.target.value) : undefined)}
                                placeholder="0.5"
                            />
                        </Field>
                    </div>

                    {/* Agent protocol */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Strategy">
                            <select
                                value={spec.strategy}
                                onChange={e => set('strategy', e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="round-robin">round-robin</option>
                                <option value="failover">failover</option>
                            </select>
                        </Field>
                        <Field label="Capability">
                            <Input
                                value={spec.capability ?? 'execute'}
                                onChange={e => set('capability', e.target.value)}
                                placeholder="execute"
                            />
                        </Field>
                    </div>

                    <Field label="API Key (optional)">
                        <Input
                            type="password"
                            value={spec.apiKey ?? ''}
                            onChange={e => set('apiKey', e.target.value)}
                            placeholder="sk-…"
                        />
                    </Field>

                    {/* Env vars */}
                    <Field label="Environment variables">
                        <div className="space-y-2">
                            {envRows.map((row, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input
                                        value={row.key}
                                        onChange={e => setEnvRow(i, 'key', e.target.value)}
                                        placeholder="KEY"
                                        className="flex-1"
                                    />
                                    <Input
                                        value={row.value}
                                        onChange={e => setEnvRow(i, 'value', e.target.value)}
                                        placeholder="value"
                                        className="flex-1"
                                    />
                                    <button
                                        onClick={() => removeEnvRow(i)}
                                        className="text-muted-foreground hover:text-red-400 shrink-0"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={addEnvRow}
                                className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add variable
                            </button>
                        </div>
                    </Field>

                    {log   && <p className="text-xs text-muted-foreground animate-pulse">{log}</p>}
                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => { reset(); onClose(); }} disabled={busy}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleDeploy} disabled={busy}>
                        {busy ? 'Deploying…' : 'Deploy'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Instance Card ──────────────────────────────────────────────────────────────

function InstanceCard({
    inst,
    onUndeploy,
}: {
    inst:      DeployedInstance;
    onUndeploy: (agentId: string) => void;
}) {
    const [busy, setBusy] = useState(false);

    async function handleUndeploy() {
        setBusy(true);
        try { await onUndeploy(inst.agentId); }
        finally { setBusy(false); }
    }

    return (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Box className="h-4 w-4 shrink-0 text-primary/70" />
                    <span className="font-semibold text-sm truncate">{inst.agentId}</span>
                </div>
                <StatusBadge status={inst.status} />
            </div>

            {/* Details */}
            <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono truncate">{inst.image}</span>
                </div>
                {inst.url && (
                    <div className="flex items-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <a
                            href={inst.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-primary/80 hover:text-primary truncate"
                        >
                            {inst.url}
                        </a>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <Container className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono">{inst.instanceId}</span>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-[10px] text-muted-foreground/50">
                    {new Date(inst.createdAt).toLocaleString()}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUndeploy}
                    disabled={busy}
                    className="h-7 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-950/30 px-2"
                >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {busy ? 'Stopping…' : 'Undeploy'}
                </Button>
            </div>
        </div>
    );
}

// ── DeployPanel ────────────────────────────────────────────────────────────────

export function DeployPanel({ initial }: { initial: DeployedInstance[] }) {
    const [instances, setInstances] = useState<DeployedInstance[]>(initial);
    const [showForm,  setShowForm]  = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    async function refresh() {
        setRefreshing(true);
        try { setInstances(await listDeployments()); }
        finally { setRefreshing(false); }
    }

    function onDeployed(inst: DeployedInstance) {
        setInstances(prev => [inst, ...prev.filter(i => i.agentId !== inst.agentId)]);
    }

    async function onUndeploy(agentId: string) {
        await undeployAgent(agentId);
        setInstances(prev => prev.filter(i => i.agentId !== agentId));
    }

    const running = instances.filter(i => i.status === 'running').length;
    const total   = instances.length;

    return (
        <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6">
                <p className="text-xs text-muted-foreground">
                    {running} running · {total} total
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={refresh}
                        disabled={refreshing}
                        className="h-8 gap-1.5 text-xs"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                        Refresh
                    </Button>
                    <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowForm(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Deploy agent
                    </Button>
                </div>
            </div>

            {/* Grid */}
            {instances.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
                    <Container className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No agents deployed yet</p>
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                        Deploy an agent from a Docker image and it will be registered automatically in the orchestrator pool.
                    </p>
                    <Button size="sm" className="mt-2 gap-1.5 text-xs" onClick={() => setShowForm(true)}>
                        <Plus className="h-3.5 w-3.5" /> Deploy first agent
                    </Button>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {instances.map(inst => (
                        <InstanceCard key={inst.instanceId} inst={inst} onUndeploy={onUndeploy} />
                    ))}
                </div>
            )}

            <DeployFormDialog
                open={showForm}
                onClose={() => setShowForm(false)}
                onDeployed={onDeployed}
            />
        </>
    );
}
