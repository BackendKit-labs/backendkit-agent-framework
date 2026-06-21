import type { Principal } from './types.js';
import type { VaultVisibilityConfig } from '../config.js';

// Shape de RagSearchResult que devuelve codex-context-agent-v2
interface RagSearchResult {
    title:      string;
    content:    string;
    relevance:  number;
    sourcePath: string;
    sourceRef?: string;
}

interface SearchResponse {
    query:        string;
    results:      RagSearchResult[];
    synthesized?: {
        title:   string;
        content: string;
        basedOn: string[];
    };
    _accessNote?: string;
}

export class VaultFilter {
    // Prefijos ordenados de mayor a menor longitud (match más específico primero)
    private readonly sortedPrefixes: [string, string[]][];

    constructor(private readonly cfg: VaultVisibilityConfig) {
        this.sortedPrefixes = Object.entries(cfg.paths)
            .sort((a, b) => b[0].length - a[0].length);
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /** true si el principal puede leer la nota en `notePath` */
    isPathAllowed(principal: Principal, notePath: string): boolean {
        const normalized = notePath.replace(/^\/+/, '');

        // Workspace custom del JWT (auth-service) — tiene prioridad sobre director.yaml
        if (principal.vault !== undefined) {
            // El usuario solo ve los namespaces que tiene asignados explícitamente
            for (const prefix of principal.vault) {
                if (normalized.startsWith(prefix)) return true;
            }
            // Si no matchea ningún namespace custom → solo permite notas sin namespace restringido
            const matchesConfigured = this.sortedPrefixes.some(([prefix]) => normalized.startsWith(prefix));
            return !matchesConfigured;  // notas públicas (sin namespace) pasan
        }

        // Sin workspace custom → usar vault_visibility del rol en director.yaml
        for (const [prefix, roles] of this.sortedPrefixes) {
            if (normalized.startsWith(prefix)) {
                return roles.includes('*') || roles.includes(principal.role);
            }
        }
        return this.cfg.default_roles.includes('*')
            || this.cfg.default_roles.includes(principal.role);
    }

    /**
     * Extrae el path de los args de `read_note` solo cuando parece una ruta
     * (contiene '/' o termina en '.md'). Los títulos sin '/' se dejan pasar
     * para no bloquear búsquedas por nombre de nota.
     */
    extractPathArg(args: Record<string, unknown>): string | undefined {
        const val = String(args['path_or_title'] ?? args['path'] ?? '');
        return (val.includes('/') || val.endsWith('.md')) ? val : undefined;
    }

    /**
     * Filtra el JSON que devuelve `search_vault`.
     * Elimina los resultados cuyo `sourcePath` no es visible para el principal
     * y, si la nota sintetizada se basó en fuentes restringidas, la descarta.
     */
    filterSearchResults(principal: Principal, rawResult: string): string {
        let response: SearchResponse;
        try {
            response = JSON.parse(rawResult) as SearchResponse;
        } catch {
            return rawResult; // No es JSON — devolvemos sin tocar
        }

        if (!response || !Array.isArray(response.results)) return rawResult;

        const before = response.results.length;
        const allowed = response.results.filter(r =>
            this.isPathAllowed(principal, r.sourcePath ?? ''),
        );
        const removedCount = before - allowed.length;

        const filtered: SearchResponse = { ...response, results: allowed };

        // Si la síntesis se basó en fuentes restringidas → descartarla
        if (filtered.synthesized?.basedOn?.some(p => !this.isPathAllowed(principal, p))) {
            delete filtered.synthesized;
        }

        if (removedCount > 0) {
            filtered._accessNote =
                `${removedCount} resultado(s) filtrado(s) por control de acceso ` +
                `(rol: "${principal.role}"). Solo se muestran notas visibles para tu rol.`;
        }

        return JSON.stringify(filtered);
    }

    denyReadMessage(principal: Principal, notePath: string): string {
        const accessible = this.allowedPrefixes(principal);
        const hint = accessible.length
            ? `Namespaces accesibles para tu rol: ${accessible.join(', ')}.`
            : 'Tu rol no tiene acceso a namespaces restringidos.';
        return (
            `Acceso denegado: tu rol "${principal.role}" no tiene visibilidad sobre "${notePath}". ` +
            hint
        );
    }

    /** Lista de prefijos de path accesibles para el principal */
    allowedPrefixes(principal: Principal): string[] {
        return this.sortedPrefixes
            .filter(([, roles]) => roles.includes('*') || roles.includes(principal.role))
            .map(([prefix]) => prefix);
    }
}
