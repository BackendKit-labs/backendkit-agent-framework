'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { cn, roleBg } from '@/lib/utils';
import type { Role } from '@/db/schema';
import { DIRECTOR_TOOL_GROUPS, VAULT_NAMESPACES } from '@/lib/tools';

interface User {
    id: string; username: string; name?: string; email?: string;
    role: string; department?: string; active: boolean;
    directorTools?: string; vaultNamespaces?: string;
    canUseDirector: boolean; canUseVault: boolean;
}

export default function EditUserPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [user,    setUser]    = useState<User | null>(null);
    const [form,    setForm]    = useState({ name: '', email: '', role: '', department: '', password: '' });
    const [depts,   setDepts]   = useState<{ id: string; name: string }[]>([]);
    const [roles,   setRoles]   = useState<Role[]>([]);
    const [roleTools, setRoleTools] = useState<string[]>([]); // tools del rol seleccionado
    const [tools,   setTools]   = useState<string[] | null>(null);  // null = usar defaults del rol
    const [vault,   setVault]   = useState<string[] | null>(null);
    const [canDir,  setCanDir]  = useState(true);
    const [canVault,setCanVault]= useState(false);
    const [saving,  setSaving]  = useState(false);
    const [msg,     setMsg]     = useState('');

    async function load() {
        const token = sessionStorage.getItem('auth_token');
        const res = await fetch(`/api/users/${params.id}`, { headers: { Authorization: `Bearer ${token}` } });
        const u = await res.json() as User;
        setUser(u);
        setForm({ name: u.name ?? '', email: u.email ?? '', role: u.role, department: u.department ?? '', password: '' });
        setTools(u.directorTools ? JSON.parse(u.directorTools) as string[] : null);
        setVault(u.vaultNamespaces ? JSON.parse(u.vaultNamespaces) as string[] : null);
        setCanDir(u.canUseDirector);
        setCanVault(u.canUseVault);
    }

    useEffect(() => {
        load();
        fetch('/api/departments').then(r => r.json()).then(setDepts).catch(() => {});
        fetch('/api/roles').then(r => r.json()).then(setRoles).catch(() => {});
    }, [params.id]); // eslint-disable-line

    // Cuando cambia el rol, cargar sus tools como defaults
    useEffect(() => {
        if (!form.role) return;
        const role = roles.find(r => r.name === form.role);
        if (role) setRoleTools(JSON.parse(role.tools) as string[]);
    }, [form.role, roles]);

    function toggleTool(tool: string) {
        const base = tools ?? ROLE_DEFAULT_TOOLS[form.role] ?? [];
        setTools(base.includes(tool) ? base.filter(t => t !== tool) : [...base, tool]);
    }

    function toggleVault(ns: string) {
        const base = vault ?? [];
        setVault(base.includes(ns) ? base.filter(n => n !== ns) : [...base, ns]);
    }

    function resetWorkspace() { setTools(null); setVault(null); }

    async function save() {
        setSaving(true); setMsg('');
        const token = sessionStorage.getItem('auth_token');
        const body: Record<string, unknown> = {
            name: form.name || null, email: form.email || null,
            role: form.role, department: form.department || null,
            directorTools: tools, vaultNamespaces: vault,
            canUseDirector: canDir, canUseVault: canVault,
        };
        if (form.password) body.password = form.password;

        await fetch(`/api/users/${params.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        setSaving(false); setMsg('Guardado ✓');
        setTimeout(() => setMsg(''), 2000);
    }

    if (!user) return <div className="text-muted-foreground p-6">Cargando...</div>;

    const activeTool = (t: string) => (tools ?? roleTools).includes(t);
    const isCustom = tools !== null;

    return (
        <div className="space-y-6 animate-fade-in max-w-4xl">
            <div className="flex items-center gap-3">
                <Link href="/admin/users" className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <div>
                    <h1 className="text-xl font-semibold">{user.username}</h1>
                    <p className="text-sm text-muted-foreground">Editar perfil y workspace</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Perfil */}
                <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
                    <h2 className="text-sm font-semibold">Perfil</h2>
                    {[
                        { key: 'name',     label: 'Nombre',     type: 'text' },
                        { key: 'email',    label: 'Email',      type: 'email' },
                        { key: 'password', label: 'Nueva contraseña (opcional)', type: 'password' },
                    ].map(({ key, label, type }) => (
                        <div key={key} className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">{label}</label>
                            <input type={type} value={form[key as keyof typeof form]}
                                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        </div>
                    ))}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Departamento</label>
                        <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40">
                            <option value="">— Sin departamento —</option>
                            {depts.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Rol base</label>
                        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40">
                            <option value="">— Seleccionar rol —</option>
                            {roles.map(r => <option key={r.id} value={r.name}>{r.label} ({r.name})</option>)}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Acceso a apps</label>
                        {[{ key: 'director', label: 'Director Chat', val: canDir, set: setCanDir }, { key: 'vault', label: 'Vault Manager', val: canVault, set: setCanVault }].map(({ key, label, val, set }) => (
                            <label key={key} className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                                    className="w-4 h-4 rounded accent-primary" />
                                <span className="text-sm">{label}</span>
                            </label>
                        ))}
                    </div>
                </section>

                {/* Vault namespaces */}
                <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">Vault — namespaces visibles</h2>
                        {vault !== null && <button onClick={() => setVault(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />Reset</button>}
                    </div>
                    {vault === null && <p className="text-xs text-muted-foreground">Usando defaults del rol <span className={cn('px-1.5 py-0.5 rounded text-[10px] border', roleBg(form.role || 'viewer'))}>{form.role || '—'}</span></p>}
                    <div className="space-y-2">
                        {VAULT_NAMESPACES.map(ns => {
                            const active = vault !== null ? vault.includes(ns) : false;
                            return (
                                <label key={ns} className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={vault !== null ? active : false}
                                        onChange={() => {
                                            if (vault === null) setVault([ns]);
                                            else toggleVault(ns);
                                        }}
                                        disabled={vault === null}
                                        className="w-4 h-4 rounded accent-primary" />
                                    <span className={cn('text-sm font-mono', vault === null && 'text-muted-foreground')}>{ns}</span>
                                </label>
                            );
                        })}
                        <button onClick={() => vault === null ? setVault([]) : setVault(null)}
                            className="text-xs text-primary hover:underline mt-1">
                            {vault === null ? 'Personalizar namespaces' : 'Volver a defaults del rol'}
                        </button>
                    </div>
                </section>
            </div>

            {/* Workspace del Director */}
            <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold">Workspace del Director</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {isCustom
                                ? `Workspace personalizado — ${tools?.length ?? 0} tools habilitadas`
                                : `Usando defaults del rol `}
                            {!isCustom && <span className={cn('px-1.5 py-0.5 rounded text-[10px] border ml-1', roleBg(form.role))}>{form.role}</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isCustom && <button onClick={resetWorkspace} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />Usar defaults del rol</button>}
                        {!isCustom && <button onClick={() => setTools([...(ROLE_DEFAULT_TOOLS[form.role] ?? [])])} className="text-xs text-primary hover:underline">Personalizar</button>}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {DIRECTOR_TOOL_GROUPS.map(group => (
                        <div key={group.label} className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                            {group.tools.map(tool => (
                                <label key={tool} className={cn('flex items-center gap-2 cursor-pointer', !isCustom && 'cursor-default')}>
                                    <input type="checkbox"
                                        checked={activeTool(tool)}
                                        onChange={() => isCustom && toggleTool(tool)}
                                        disabled={!isCustom}
                                        className="w-3.5 h-3.5 rounded accent-primary" />
                                    <span className={cn('text-xs font-mono', !isCustom && activeTool(tool) ? 'text-foreground' : !isCustom ? 'text-muted-foreground' : activeTool(tool) ? 'text-foreground' : 'text-muted-foreground')}>{tool}</span>
                                </label>
                            ))}
                        </div>
                    ))}
                </div>
            </section>

            {/* Save */}
            <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                {msg && <span className="text-sm text-emerald-400">{msg}</span>}
            </div>
        </div>
    );
}
