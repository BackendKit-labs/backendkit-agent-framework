import { useState } from "react"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { usersApi } from "../lib/api"
import { Loader2, Plus, X } from "lucide-react"

const DEPARTMENTS = ['development', 'devops', 'sales', 'finance', 'hr']

interface User {
    id: string
    department?: string | null
    vaultResources?: string[] | null
}

interface Props {
    user: User
    onUpdated: (updated: User) => void
}

export function DepartmentEditor({ user, onUpdated }: Props) {
    const [saving, setSaving] = useState(false)
    const [department, setDepartment] = useState<string>(user.department ?? '')
    const [vaultResources, setVaultResources] = useState<string[]>(user.vaultResources ?? [])
    const [newPattern, setNewPattern] = useState('')
    const [patternError, setPatternError] = useState('')

    const isDirty =
        department !== (user.department ?? '') ||
        JSON.stringify(vaultResources) !== JSON.stringify(user.vaultResources ?? [])

    async function save() {
        setSaving(true)
        try {
            await usersApi.update(user.id, {
                department: department || null,
                vaultResources: vaultResources.length > 0 ? vaultResources : null,
            })
            onUpdated({ ...user, department: department || null, vaultResources: vaultResources.length > 0 ? vaultResources : null })
        } finally {
            setSaving(false)
        }
    }

    function addPattern() {
        const p = newPattern.trim()
        if (!p) return
        if (vaultResources.includes(p)) {
            setPatternError('Pattern ya existe')
            return
        }
        setPatternError('')
        setVaultResources(prev => [...prev, p])
        setNewPattern('')
    }

    function removePattern(p: string) {
        setVaultResources(prev => prev.filter(x => x !== p))
    }

    return (
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
            <h4 className="text-sm font-semibold">MCP Resources</h4>

            {/* Department */}
            <div className="space-y-1.5">
                <Label className="text-xs">Department <span className="text-muted-foreground">(define el ceiling de recursos)</span></Label>
                <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Sin department" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">Sin department</SelectItem>
                        {DEPARTMENTS.map(d => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Vault Resources override */}
            <div className="space-y-2">
                <Label className="text-xs">
                    vault_resources <span className="text-muted-foreground">(override personal — vacío = hereda el ceiling completo)</span>
                </Label>
                <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                    {vaultResources.map(p => (
                        <span key={p} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-mono text-primary">
                            {p}
                            <button onClick={() => removePattern(p)} className="hover:text-destructive transition-colors">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                    {vaultResources.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">Hereda el ceiling del department</span>
                    )}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newPattern}
                        onChange={e => { setNewPattern(e.target.value); setPatternError('') }}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addPattern())}
                        placeholder="ej: hubspot://contacts/* ó jira://*"
                        className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button size="sm" variant="outline" onClick={addPattern} className="h-8 px-2">
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                </div>
                {patternError && <p className="text-xs text-destructive">{patternError}</p>}
            </div>

            {isDirty && (
                <Button size="sm" onClick={save} disabled={saving} className="h-8">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    Guardar cambios MCP
                </Button>
            )}
        </div>
    )
}
