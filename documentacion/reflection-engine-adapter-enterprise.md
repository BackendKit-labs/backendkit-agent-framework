# EnterpriseReflection — Adapter del Reflection Engine para agentes empresariales

> Diseño de integración del `ReflectionEngine` de `agent-core` en la librería
> `@backendkit-labs/agent-enterprise`, sin modificar el core compartido con los
> agentes de codificación.

---

## 1. Contexto y problema

El **Reflection Engine** nació como parte de un agente de codificación (`deepseek-code`)
que aprende de sus errores. Funcionaba y se usaba **antes** de construir el framework.
Implementa el patrón **MAPE-K** (Monitor–Analyze–Plan–Execute over a Knowledge base) y,
en concreto, es un **compilador de errores recurrentes a reglas deterministas**:

```
reportIncident() → FailureCatalog → PatternDetector → PolicyPromoter → manifest.yaml
```

**Regla de oro:** si el mismo `failureType` aparece ≥3 veces (`promotionThreshold`),
deja de tratarse como incidente y se promueve a una `policyRule` con forma `if/then`
que el sistema aplica **sin pasar por el LLM**.

### El dilema

Cambiar la naturaleza del `ReflectionEngine` para adaptarlo al uso empresarial
podría afectar el comportamiento de los agentes de codificación que dependen de él.
La pregunta: ¿hacer otra versión para enterprise, o el engine actual no corre riesgo?

### La respuesta: ni fork ni modificar el core

El análisis del código (`agent-core/dist/reflection/`) confirma que **no hay estado
global compartido**:

1. **No hay singleton.** Todo lo que exporta `reflection/index` son clases que se
   instancian. El coding agent y el enterprise corren como **dos instancias separadas**
   — comparten la clase (código), nunca el estado.
2. **El estado persistente está scopeado por path:**
   - `FailureCatalog` → `~/.{appName}/projects/{hash}/reflection/`
   - `DomainRegistry` → `~/.{appName}/domains/...` (default `deepseek-code`)
   - `manifestPath` → configurable por instancia
3. **Los dominios custom son ciudadanos de primera clase.** `DomainRegistry.registerDomain()`
   agrega dominios enterprise con sus propios `failureTypes`, cada uno con su `severity`.
   Los 5 built-in (audit, test, commit, agent, bootstrap) no se pueden eliminar, solo
   desactivar por proyecto.

**Conclusión:** el engine actual no corre riesgo de comportamiento para los agentes de
coding —porque no hay estado runtime compartido— **con una condición**: que la instancia
enterprise no colisione en disco con la de coding (`appName` + `manifestPath` + `useGlobalDir`
aislados). El dilema "fork vs modificar core" es un falso binario: la respuesta correcta
es una **tercera opción — composición mediante un adapter**.

### Principio que gobierna la decisión

> **Toda lógica enterprise vive fuera de `agent-core`.** `agent-core` es dependencia
> compartida; cualquier cambio en su core sube la versión y afecta a los agentes de
> coding. Umbral por severidad, gate de promoción y defensa anti-poison se implementan
> en el paquete enterprise, no en el mecanismo compartido. Esto es el principio
> "complementar, nunca competir" aplicado: el enterprise *compone* sobre el core.

---

## 2. Ubicación y estructura

```
packages/enterprise/src/reflection/
  EnterpriseReflection.ts     ← el adapter (orquesta el engine)
  domains.ts                  ← definición de dominios enterprise
  GateReflectionBridge.ts     ← ComplianceGate → reportIncident
  index.ts
```

**Cero líneas tocadas en `agent-core`.** El adapter importa `ReflectionEngine`,
`DomainRegistry`, `PolicyPromoter` desde `@backendkit-labs/agent-core` y los compone.

---

## 3. Flujo completo (MAPE-K cableado a las piezas existentes)

```
┌─ MONITOR ────────────────────────────────────────────────┐
│ ComplianceGate.getRecord()  →  GateReflectionBridge       │
│   verdict 'failed' / criterion rejected → incidente       │
│   self_evaluation / missing_evidence    → incidente meta  │
│   provenance = gate.evaluator (NO el executor juzgado)    │
└──────────────────────────────┬───────────────────────────┘
                               ↓ engine.reportIncident()
┌─ ANALYZE ─────────────────────────────────────────────────┐
│ detector.scanByFailureType(domain, ft, threshold(ft))     │
│   threshold derivado de severity: crit=1 high=2 med/low=3 │
└──────────────────────────────┬───────────────────────────┘
                               ↓ DetectedPattern[] (sin promover)
┌─ PLAN + EXECUTE ──────────────────────────────────────────┐
│ pendingPromotions() → aprobación humana → promoter.promote │
│   autoPromote: false  (gate humano obligatorio)           │
│   la aprobación pasa por el MISMO orchestrator_approve     │
└──────────────────────────────┬───────────────────────────┘
                               ↓ manifest.yaml (policyRules)
┌─ KNOWLEDGE ───────────────────────────────────────────────┐
│ executor lee activeRules() ANTES de ejecutar un step      │
│   → fuerza gate / inyecta constraint, sin pasar por LLM    │
│ recordRuleOutcome() → telemetría → demotionCandidates()   │
└───────────────────────────────────────────────────────────┘
```

**Simetría clave:** la promoción de una regla se aprueba con la misma maquinaria que
aprueba una acción de negocio (`orchestrator_approve`). El sistema que autoriza
decisiones también autoriza cambios a su propio reglamento.

---

## 4. Configuración de aislamiento (el único riesgo real, resuelto)

```ts
new ReflectionEngine({
  appName:     'bk-enterprise',          // ≠ 'deepseek-code' → catálogo aparte
  useGlobalDir: false,                    // no comparte catálogo global
  config: {
    manifestPath: path.join(vaultPath, 'politicas', '_generated', 'manifest.yaml'),
    autoPromote:  false,                  // gate humano
    activeDomains: ENTERPRISE_DOMAINS.map(d => d.name),  // solo dominios enterprise
  },
})
```

El `manifest.yaml` generado vive **dentro del vault** (`/politicas/_generated/`):
versionable en git, auditable, y separado de las políticas seed escritas a mano
(`/politicas/{domain}/`).

---

## 5. Dominios enterprise: el puente policy ↔ failureType

Cada política del `PolicySeeder` tiene su `failureType` espejo. Esa es la elegancia:
**una política violada genera un incidente del tipo correspondiente; si se repite, se
promueve a regla determinista.**

```ts
// domains.ts
export const ENTERPRISE_DOMAINS: CustomDomainDefinition[] = [
  {
    name: 'legal',
    description: 'Contratos, cláusulas, compliance normativo',
    failureTypes: [
      { name: 'non_compliant_clause',   severity: 'critical', dimension: 'compliance',
        keywords: ['normativa','ilegal','incumple','irregular'],
        recommendation: 'Revisión legal obligatoria antes de emitir contrato' },
      { name: 'missing_confidentiality', severity: 'high',    dimension: 'compliance',
        keywords: ['confidencialidad','nda','cláusula faltante'], recommendation: '...' },
      { name: 'salary_out_of_policy',    severity: 'high',     dimension: 'finanzas',
        keywords: ['salario','remuneración','fuera de banda'],   recommendation: '...' },
    ],
  },
  {
    name: 'finanzas',
    failureTypes: [
      { name: 'over_approval_threshold', severity: 'critical' }, // ← espejo de approval-authority.md
      { name: 'confidential_data_leak',  severity: 'critical' }, // ← espejo de confidentiality.md
    ],
  },
  { name: 'rrhh', failureTypes: [
      { name: 'pii_exposure',         severity: 'critical' }, // ← data-privacy.md
      { name: 'incomplete_checklist', severity: 'medium' },
  ]},
  // ventas, operaciones, soporte …
];
```

---

## 6. El bridge: determinista, no por regex

Para evitar la fragilidad del keyword-match (misma fragilidad que el router de flows),
se extiende `GateCriterion` **en el paquete enterprise** (permitido — `ComplianceGate`
vive en enterprise, no en core) con un `failureType` explícito:

```ts
// ComplianceGate.ts — GateCriterion, cambio LOCAL al enterprise
export interface GateCriterion {
  id: string;
  description: string;
  failureType?: string;   // ← tag explícito; si falta, cae al keyword-match del registry
  domain?: string;        // ← dominio de negocio del criterio
  passed?: boolean;
  // …
}
```

```ts
// GateReflectionBridge.ts
async function recordGateOutcome(record: GateRecord, engine: ReflectionEngine) {
  const incidents: FailureRecord[] = [];
  for (const c of record.criteria) {
    if (c.passed !== false) continue;                  // solo fallos
    const { record: r } = await engine.reportIncident({
      domain:            c.domain ?? 'agent',
      failureType:       c.failureType ?? '',          // '' → registry lo detecta por keywords
      severity:          severityOf(c.domain, c.failureType),
      dimension:         'compliance',
      gate:              record.stepId,
      agenteResponsable: record.executor,              // QUIÉN falló
      hallazgo:          c.description,
      recomendacion:     '',
      archivos:          [],
      fecha:             new Date().toISOString(),
      contextRaw:        JSON.stringify({ reportedBy: record.executor, evaluator: evaluatorOf(record) }),
    });
    incidents.push(r);
  }
  // integridad del proceso, no del negocio → dominio meta
  for (const e of record.log) {
    if (e.event === 'self_evaluation_attempt' || e.event === 'missing_evidence_attempt') {
      await engine.reportIncident({ domain: 'agent', failureType: 'gate_integrity_violation', /* … */ });
    }
  }
  return incidents;
}
```

**Provenance anti-poison:** el incidente se ancla al `evaluator` del gate (evaluator≠executor
ya garantizado por `ComplianceGate`). Un agente no puede auto-reportar fallos para envenenar
el catálogo — el reporte siempre pasa por el evaluador independiente. Se reusa la garantía
existente, sin sistema de confianza nuevo.

---

## 7. API del adapter

```ts
export class EnterpriseReflection {
  constructor(opts: { vaultPath: string; appName?: string; manifestPath?: string });

  async initialize(): Promise<void>;          // engine.initialize + registra/activa dominios

  // MONITOR
  async recordGateOutcome(record: GateRecord): Promise<FailureRecord[]>;

  // ANALYZE — umbral por severidad, sin promover
  async detect(domain?: string): Promise<DetectedPattern[]>;

  // PLAN/EXECUTE — promoción con gate humano
  async pendingPromotions(): Promise<DetectedPattern[]>;
  async approvePromotion(pattern: DetectedPattern, approver: string): Promise<ManifestPolicyRule>;
  async rejectPromotion(pattern: DetectedPattern, approver: string, reason: string): Promise<void>;

  // KNOWLEDGE — consumido por el executor
  async activeRules(filter?: { domain?: string }): Promise<ManifestPolicyRule[]>;
  async recordRuleOutcome(ruleId: string, outcome: 'success' | 'failure'): Promise<void>;
  async demotionCandidates(minFailures?: number): Promise<ManifestPolicyRule[]>;  // auto-demotion
}
```

El `detect()` es donde vive el umbral-por-severidad, manejado en el driver (no en el core):

```ts
async detect(domain?: string): Promise<DetectedPattern[]> {
  const detector = this.engine.getDetector();
  const domains  = domain ? [domain] : this.activeDomains;
  const out: DetectedPattern[] = [];
  for (const d of domains) {
    for (const ft of this.failureTypesOf(d)) {
      const threshold = SEVERITY_THRESHOLD[ft.severity];   // crit=1 high=2 med/low=3
      out.push(...await detector.scanByFailureType(d, ft.name, threshold));
    }
  }
  return out;
}
```

---

## 8. Puntos de integración (dos cables)

1. **Salida** — en el `FlowRunner`/`PlanExecutor`, después de que un gate resuelve:
   ```ts
   await enterpriseReflection.recordGateOutcome(gate.getRecord());
   ```
   Una línea.

2. **Entrada** — en el executor, **antes** de correr un step:
   ```ts
   const rules = await enterpriseReflection.activeRules({ domain });
   ```
   Si una regla matchea el subtask, fuerza gate o inyecta el constraint en el prompt
   — determinista, sin LLM. Ahí se cierra el flywheel: **el error de hoy es el guardrail
   de mañana.**

---

## 9. Cómo se diferencia del uso en coding

| Aspecto | Coding agent (`deepseek-code`) | Enterprise (`bk-enterprise`) |
|---|---|---|
| `appName` | `deepseek-code` | `bk-enterprise` |
| `manifestPath` | manifest del proyecto de código | `{vault}/politicas/_generated/manifest.yaml` |
| `useGlobalDir` | según config | `false` (aislado) |
| `autoPromote` | `true` (promoción automática) | `false` (gate humano) |
| Umbral | fijo `3` | por severidad (crit=1, high=2, med/low=3) |
| Dominios activos | audit, test, commit, agent, bootstrap | legal, finanzas, rrhh, ventas, operaciones, soporte |
| Fuente de incidentes | evaluator de respuestas, agent loop | `ComplianceGate` (evaluator≠executor) |
| Promoción | escribe manifest directo | draft → aprobación → `promote()` |

Ambas instancias comparten la **clase** (`agent-core`), nunca el **estado** (archivos
scopeados por `appName`/`projectRoot`/`manifestPath`).

---

## 10. Decisiones abiertas

1. **`manifest.yaml` dentro del vault vs en config dir de la empresa.**
   - *Dentro del vault* (`/politicas/_generated/`): versionable en git + auditable +
     RAG-consultable, pero mezcla "reglas generadas" con "conocimiento".
   - *Fuera*: más limpio conceptualmente, pero pierde auditoría git.
   - **Recomendación:** dentro del vault, por auditabilidad — alineado con la visión de
     "humanos auditan".

2. **Auto-demotion: ¿automática o con gate?**
   Una regla con muchos `failure` outcomes, ¿se retira sola o requiere aprobación como
   la promoción?
   - **Recomendación:** gate humano para ambas direcciones (coherencia: el reglamento
     solo cambia con aprobación).

---

## Referencias

- `agent-core/dist/reflection/` — código fuente del `ReflectionEngine` (compilado)
- `packages/enterprise/src/flow/ComplianceGate.ts` — evaluator≠executor, fuente de incidentes
- `packages/enterprise/src/policies/PolicySeeder.ts` — políticas seed espejo de los failureTypes
- [`arquitectura-sistema-multiagente.md`](./arquitectura-sistema-multiagente.md) — arquitectura general
- [`vision-y-viabilidad.md`](./vision-y-viabilidad.md) — visión de empresa autónoma
