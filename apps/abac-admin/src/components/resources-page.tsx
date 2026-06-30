import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "./ui/alert"
import { resourcesApi, type DepartmentResource } from "../lib/api"
import { Trash2, Plus, Loader2, ShieldCheck } from "lucide-react"

const DEPARTMENTS = ['development', 'devops', 'sales', 'finance', 'hr']

export function ResourcesPage() {
    const [resources, setResources] = useState<DepartmentResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [filterDept, setFilterDept] = useState('')

    // Add form
    const [form, setForm] = useState({ department: '', uriPattern: '', description: '' })
    const [adding, setAdding] = useState(false)
    const [formError, setFormError] = useState('')

    const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const res = await resourcesApi.list(filterDept || undefined)
            setResources(res.data)
        } catch {
            setError('No se pudo cargar los recursos. Verificá que abac-service esté corriendo.')
        } finally {
            setLoading(false)
        }
    }, [filterDept])

    useEffect(() => { load() }, [load])

    async function handleAdd() {
        if (!form.department || !form.uriPattern) {
            setFormError('Department y URI Pattern son requeridos.')
            return
        }
        setFormError('')
        setAdding(true)
        try {
            const res = await resourcesApi.add(form.department, form.uriPattern, form.description || undefined)
            setResources(prev => [...prev, res.data])
            setForm({ department: '', uriPattern: '', description: '' })
        } catch {
            setFormError('Error al agregar el recurso.')
        } finally {
            setAdding(false)
        }
    }

    async function handleRemove(id: string) {
        if (!confirm('¿Desactivar este URI pattern?')) return
        try {
            await resourcesApi.remove(id)
            setResources(prev => prev.filter(r => r.id !== id))
        } catch {
            // silent — user can retry
        }
    }

    const grouped = resources.reduce<Record<string, DepartmentResource[]>>((acc, r) => {
        (acc[r.department] ??= []).push(r)
        return acc
    }, {})

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">MCP Resources</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        URI patterns de recursos disponibles por department — techo de acceso a context pre-cargado.
                    </p>
                </div>
                <ShieldCheck className="h-8 w-8 text-primary/60" />
            </div>

            {/* Info banner */}
            <Alert>
                <AlertDescription className="text-sm">
                    Cada usuario hereda los patterns del department al que pertenece.
                    Un <code className="font-mono text-xs bg-muted px-1 rounded">vault_resources</code> personal
                    solo puede reducir el conjunto, nunca ampliarlo.
                    Los hosts MCP filtran <code className="font-mono text-xs bg-muted px-1 rounded">resources/list</code> y
                    validan <code className="font-mono text-xs bg-muted px-1 rounded">resources/read</code> contra estos patterns en tiempo real.
                </AlertDescription>
            </Alert>

            {/* Add form */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Agregar URI Pattern</CardTitle>
                    <CardDescription>Define un nuevo recurso MCP disponible para un department.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex flex-col gap-1.5 min-w-[160px]">
                            <Label className="text-xs">Department *</Label>
                            <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
                                <SelectTrigger className="h-9 text-sm">
                                    <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-[2]">
                            <Label className="text-xs">URI Pattern *</Label>
                            <input
                                type="text"
                                value={form.uriPattern}
                                onChange={e => setForm(f => ({ ...f, uriPattern: e.target.value }))}
                                placeholder="jira://* ó hubspot://contacts/*"
                                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5 flex-[2]">
                            <Label className="text-xs">Descripción</Label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                placeholder="Opcional"
                                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <Button onClick={handleAdd} disabled={adding} className="h-9 gap-2 shrink-0">
                            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Agregar
                        </Button>
                    </div>
                    {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
                </CardContent>
            </Card>

            {/* Filter */}
            <div className="flex items-center gap-3">
                <Label className="text-sm shrink-0">Filtrar por department:</Label>
                <Select value={filterDept} onValueChange={setFilterDept}>
                    <SelectTrigger className="w-48 h-8 text-sm">
                        <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">Todos</SelectItem>
                        {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={load} className="h-8">
                    Actualizar
                </Button>
            </div>

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Resource list grouped by department */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : Object.keys(grouped).length === 0 ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-muted-foreground text-sm">No hay resources configurados.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dept, rows]) => (
                        <Card key={dept}>
                            <CardHeader className="pb-2 pt-4 px-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{dept}</span>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{rows.length}</span>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="pl-4">URI Pattern</TableHead>
                                            <TableHead>Descripción</TableHead>
                                            <TableHead className="w-10" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map(r => (
                                            <TableRow key={r.id} className="group">
                                                <TableCell className="pl-4 font-mono text-xs">{r.uriPattern}</TableCell>
                                                <TableCell className="text-sm text-muted-foreground">{r.description ?? '—'}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleRemove(r.id)}
                                                        title="Desactivar"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
