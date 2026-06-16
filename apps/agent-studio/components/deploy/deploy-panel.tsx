'use client';

import { useState, useEffect } from 'react';
import {
    Box, Plus, Trash2, RefreshCw, ExternalLink,
    Container, HardDrive, Cpu, Layers, ChevronRight, Tag,
} from 'lucide-react';
import {
    cn, Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui';
import type { DeployedInstance, DeploySpec, AgentConfig, DeploySettings } from '@/lib/gateway';
import {
    deployAgent, undeployAgent, listDeployments,
    listConfigAgents, getDeploySettings,
} from '@/lib/gateway';

// ── Primitives ─────────────────────────────────────────────────────────────────

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
                : 'bg-yellow-950/40 text-yellow-400 border border-yellow-700/30',
        )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400')} />
            {status}
        </span>
    );
}

function CapabilityBadge({ cap }: { cap?: string }) {
    if (!cap) return null;
    return (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary/80 border border-primary/20">
            {cap}
        </span>
    );
}

// ── Deploy Config Dialog ───────────────────────────────────────────────────────

interface MountEntry { host: string; container: string; mode: 'rw' | 'ro'; }
interface EnvEntry   { key: string; value: string; }

const MEMORY_OPTIONS = [128, 256, 512, 1024, 2048, 4096];
const CPU_OPTIONS    = [0.25, 0.5, 1, 2, 4];

function DeployConfigDialog({
    open, agent, settings, onClose, onDeployed,
}: {
    open:       boolean;
    agent:      AgentConfig | null;
    settings:   DeploySettings;
    onClose:    () => void;
    onDeployed: (inst: DeployedInstance) => void;
}) {
    const [image,      setImage]      = useState('');
    const [name,       setName]       = useState('');
    const [instances,  setInstances]  = useState(1);
    const [memoryMb,   setMemoryMb]   = useState<number | undefined>(undefined);
    const [cpus,       setCpus]       = useState<number | undefined>(undefined);
    const [mountVault, setMountVault] = useState(false);
    const [mounts,     setMounts]     = useState<MountEntry[]>([]);
    const [envRows,    setEnvRows]    = useState<EnvEntry[]>([]);
    const [apiKey,     setApiKey]     = useState('');
    const [busy,       setBusy]       = useState(false);
    const [log,        setLog]        = useState('');
    const [error,      setError]      = useState('');

    // Pre-fill from catalog selection
    useEffect(() => {
        if (agent) {
            setImage(agent.image ?? '');
            setName(agent.id);
            setInstances(1);
            setMountVault(false);
            setMounts([]);
            setEnvRows([]);
            setApiKey('');
            setError('');
            setLog('');
        }
    }, [agent]);

    function reset() {
        setImage(''); setName(''); setInstances(1);
        setMemoryMb(undefined); setCpus(undefined);
        setMountVault(false); setMounts([]); setEnvRows([]);
        setApiKey(''); setError(''); setLog('');
    }

    function addMount()  { setMounts(m => [...m, { host: '', container: '/data', mode: 'rw' }]); }
    function rmMount(i: number) { setMounts(m => m.filter((_, idx) => idx !== i)); }
    function setMount(i: number, f: keyof MountEntry, v: string) {
        setMounts(m => { const n = [...m]; n[i] = { ...n[i], [f]: v }; return n; });
    }

    function addEnv()  { setEnvRows(r => [...r, { key: '', value: '' }]); }
    function rmEnv(i: number) { setEnvRows(r => r.filter((_, idx) => idx !== i)); }
    function setEnv(i: number, f: 'key' | 'value', v: string) {
        setEnvRows(r => { const n = [...r]; n[i] = { ...n[i], [f]: v }; return n; });
    }

    async function handleDeploy() {
        if (!agent?.id && !name.trim()) return setError('Agent ID is required');
        if (!image.trim()) return setError('Docker image is required');

        // Build mounts array
        const allMounts: string[] = [];
        if (mountVault && settings.vaultHostPath) {
            allMounts.push(`${settings.vaultHostPath}:/vault:ro`);
        }
        for (const m of mounts) {
            if (m.host.trim() && m.container.trim()) {
                allMounts.push(`${m.host.trim()}:${m.container.trim()}:${m.mode}`);
            }
        }

        // Build env object
        const env: Record<string, string> = {};
        for (const { key, value } of envRows) {
            if (key.trim()) env[key.trim()] = value;
        }
        if (mountVault) env['VAULT_PATH'] = '/vault';

        const spec: DeploySpec = {
            id:          agent?.id ?? name.trim(),
            image:       image.trim(),
            name:        name.trim() || undefined,
            description: agent?.description,
            capability:  agent?.capability ?? 'execute',
            strategy:    agent?.strategy   ?? 'round-robin',
            instances,
            ...(memoryMb               && { memoryMb }),
            ...(cpus                   && { cpus }),
            ...(apiKey.trim()          && { apiKey: apiKey.trim() }),
            ...(allMounts.length       && { mounts: allMounts }),
            ...(Object.keys(env).length && { env }),
        };

        setBusy(true);
        setError('');
        setLog(`Pulling ${image} and starting ${instances} container${instances > 1 ? 's' : ''}…`);

        try {
            const result = await deployAgent(spec);
            if (!result.ok || result.error) {
                setError(result.error ?? 'Deploy failed');
                return;
            }
            onDeployed({
                instanceId: result.instanceId!,
                agentId:    spec.id,
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

    if (!agent) return null;

    return (
        <Dialog open={open} onOpenChange={v => { if (!v && !busy) { reset(); onClose(); } }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Container className="h-4 w-4 text-primary" />
                        Deploy · <span className="font-mono text-primary/80">{agent.id}</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* Image */}
                    <Field label="Docker Image *">
                        <Input
                            value={image}
                            onChange={e => setImage(e.target.value)}
                            placeholder="registry/image:tag"
                        />
                    </Field>

                    {/* Name + Instances */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Container name">
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={agent.id}
                            />
                        </Field>
                        <Field label="Instances">
                            <div className="flex items-center gap-2">
                                <input
                                    type="range" min={1} max={8} value={instances}
                                    onChange={e => setInstances(Number(e.target.value))}
                                    className="flex-1 accent-primary"
                                />
                                <span className="text-sm font-mono w-4 text-center">{instances}</span>
                            </div>
                        </Field>
                    </div>

                    {/* Resources */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Memory">
                            <select
                                value={memoryMb ?? ''}
                                onChange={e => setMemoryMb(e.target.value ? Number(e.target.value) : undefined)}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="">no limit</option>
                                {MEMORY_OPTIONS.map(m => (
                                    <option key={m} value={m}>{m >= 1024 ? `${m / 1024} GB` : `${m} MB`}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="CPU">
                            <select
                                value={cpus ?? ''}
                                onChange={e => setCpus(e.target.value ? Number(e.target.value) : undefined)}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="">no limit</option>
                                {CPU_OPTIONS.map(c => (
                                    <option key={c} value={c}>{c} core{c !== 1 ? 's' : ''}</option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    {/* Vault mount */}
                    <div className="rounded-lg border border-border p-3 space-y-2">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={mountVault}
                                onChange={e => setMountVault(e.target.checked)}
                                className="accent-primary"
                                disabled={!settings.vaultHostPath}
                            />
                            <div>
                                <p className={cn('text-sm font-medium', !settings.vaultHostPath && 'text-muted-foreground')}>
                                    Mount Vault
                                </p>
                                {settings.vaultHostPath ? (
                                    <p className="text-[10px] text-muted-foreground font-mono">
                                        {settings.vaultHostPath} → /vault (read-only)
                                    </p>
                                ) : (
                                    <p className="text-[10px] text-yellow-500">
                                        Set VAULT_HOST_PATH in orchestrator .env to enable
                                    </p>
                                )}
                            </div>
                        </label>
                    </div>

                    {/* Custom mounts */}
                    <Field label="Additional mounts">
                        <div className="space-y-2">
                            {mounts.map((m, i) => (
                                <div key={i} className="flex gap-1.5 items-center">
                                    <Input
                                        value={m.host}
                                        onChange={e => setMount(i, 'host', e.target.value)}
                                        placeholder="/host/path"
                                        className="flex-1"
                                    />
                                    <span className="text-muted-foreground text-xs">:</span>
                                    <Input
                                        value={m.container}
                                        onChange={e => setMount(i, 'container', e.target.value)}
                                        placeholder="/container/path"
                                        className="flex-1"
                                    />
                                    <select
                                        value={m.mode}
                                        onChange={e => setMount(i, 'mode', e.target.value)}
                                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none"
                                    >
                                        <option value="rw">rw</option>
                                        <option value="ro">ro</option>
                                    </select>
                                    <button onClick={() => rmMount(i)} className="text-muted-foreground hover:text-red-400">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                            <button onClick={addMount} className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary">
                                <Plus className="h-3.5 w-3.5" /> Add mount
                            </button>
                        </div>
                    </Field>

                    {/* Env vars */}
                    <Field label="Environment variables">
                        <div className="space-y-2">
                            {envRows.map((row, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input
                                        value={row.key}
                                        onChange={e => setEnv(i, 'key', e.target.value)}
                                        placeholder="KEY"
                                        className="flex-1"
                                    />
                                    <Input
                                        value={row.value}
                                        onChange={e => setEnv(i, 'value', e.target.value)}
                                        placeholder="value"
                                        className="flex-1"
                                    />
                                    <button onClick={() => rmEnv(i)} className="text-muted-foreground hover:text-red-400">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                            <button onClick={addEnv} className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary">
                                <Plus className="h-3.5 w-3.5" /> Add variable
                            </button>
                        </div>
                    </Field>

                    <Field label="API Key (optional)">
                        <Input
                            type="password"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="sk-…"
                        />
                    </Field>

                    {log   && <p className="text-xs text-muted-foreground animate-pulse">{log}</p>}
                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => { reset(); onClose(); }} disabled={busy}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleDeploy} disabled={busy}>
                        {busy ? 'Deploying…' : `Deploy${instances > 1 ? ` × ${instances}` : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Catalog Card ───────────────────────────────────────────────────────────────

function CatalogCard({
    agent,
    runningCount,
    onDeploy,
}: {
    agent:        AgentConfig;
    runningCount: number;
    onDeploy:     (agent: AgentConfig) => void;
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{agent.id}</p>
                    {agent.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.description}</p>
                    )}
                </div>
                <CapabilityBadge cap={agent.capability} />
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
                {agent.image ? (
                    <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono truncate">{agent.image}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-yellow-500/70">
                        <Tag className="h-3.5 w-3.5 shrink-0" />
                        <span className="italic">no image configured</span>
                    </div>
                )}
                {runningCount > 0 && (
                    <div className="flex items-center gap-2 text-emerald-400">
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        <span>{runningCount} running</span>
                    </div>
                )}
            </div>

            <Button
                size="sm"
                variant={runningCount > 0 ? 'ghost' : 'default'}
                className="w-full h-7 text-xs gap-1.5 mt-auto"
                onClick={() => onDeploy(agent)}
            >
                {runningCount > 0 ? 'Redeploy' : 'Deploy'}
                <ChevronRight className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}

// ── Instance Card ──────────────────────────────────────────────────────────────

function InstanceCard({ inst, onUndeploy }: { inst: DeployedInstance; onUndeploy: (id: string) => void }) {
    const [busy, setBusy] = useState(false);

    return (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Box className="h-4 w-4 shrink-0 text-primary/70" />
                    <span className="font-semibold text-sm truncate">{inst.agentId}</span>
                </div>
                <StatusBadge status={inst.status} />
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono truncate">{inst.image}</span>
                </div>
                {inst.url && (
                    <div className="flex items-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <a href={inst.url} target="_blank" rel="noreferrer"
                            className="font-mono text-primary/80 hover:text-primary truncate">
                            {inst.url}
                        </a>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <Container className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono">{inst.instanceId}</span>
                </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-[10px] text-muted-foreground/50">
                    {new Date(inst.createdAt).toLocaleString()}
                </span>
                <Button
                    variant="ghost" size="sm" disabled={busy}
                    onClick={async () => { setBusy(true); try { await onUndeploy(inst.agentId); } finally { setBusy(false); } }}
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
    const [instances,   setInstances]   = useState<DeployedInstance[]>(initial);
    const [catalog,     setCatalog]     = useState<AgentConfig[]>([]);
    const [settings,    setSettings]    = useState<DeploySettings>({ vaultHostPath: null, runtime: 'docker' });
    const [selected,    setSelected]    = useState<AgentConfig | null>(null);
    const [refreshing,  setRefreshing]  = useState(false);

    useEffect(() => {
        Promise.all([listConfigAgents(), getDeploySettings()]).then(([agents, s]) => {
            setCatalog(agents);
            setSettings(s);
        });
    }, []);

    async function refresh() {
        setRefreshing(true);
        try {
            const [agents, s, deploys] = await Promise.all([
                listConfigAgents(), getDeploySettings(), listDeployments(),
            ]);
            setCatalog(agents);
            setSettings(s);
            setInstances(deploys);
        } finally { setRefreshing(false); }
    }

    function onDeployed(inst: DeployedInstance) {
        setInstances(prev => [inst, ...prev.filter(i => i.agentId !== inst.agentId)]);
    }

    async function onUndeploy(agentId: string) {
        await undeployAgent(agentId);
        setInstances(prev => prev.filter(i => i.agentId !== agentId));
    }

    const runningByAgent = instances.reduce<Record<string, number>>((acc, i) => {
        if (i.status === 'running') acc[i.agentId] = (acc[i.agentId] ?? 0) + 1;
        return acc;
    }, {});

    const running = instances.filter(i => i.status === 'running').length;

    return (
        <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6">
                <div className="space-y-0.5">
                    <p className="text-sm font-medium">Agent Catalog</p>
                    <p className="text-xs text-muted-foreground">
                        {catalog.length} registered · {running} running
                        {settings.vaultHostPath && (
                            <span className="ml-2 text-emerald-400/70">· vault mounted</span>
                        )}
                    </p>
                </div>
                <Button
                    variant="ghost" size="sm" onClick={refresh} disabled={refreshing}
                    className="h-8 gap-1.5 text-xs"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                    Refresh
                </Button>
            </div>

            {/* Catalog */}
            {catalog.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center mb-8">
                    <HardDrive className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No agents registered</p>
                    <p className="text-xs text-muted-foreground/60">Add agents in the Agents tab first</p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
                    {catalog.map(agent => (
                        <CatalogCard
                            key={agent.id}
                            agent={agent}
                            runningCount={runningByAgent[agent.id] ?? 0}
                            onDeploy={setSelected}
                        />
                    ))}
                </div>
            )}

            {/* Running instances */}
            <div className="mb-4">
                <p className="text-sm font-medium mb-3">Running Containers</p>
                {instances.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
                        <Container className="h-6 w-6 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">No containers running</p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {instances.map(inst => (
                            <InstanceCard key={inst.instanceId} inst={inst} onUndeploy={onUndeploy} />
                        ))}
                    </div>
                )}
            </div>

            <DeployConfigDialog
                open={selected !== null}
                agent={selected}
                settings={settings}
                onClose={() => setSelected(null)}
                onDeployed={onDeployed}
            />
        </>
    );
}
