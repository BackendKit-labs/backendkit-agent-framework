# Diseño — Framework multi-agente agnóstico al dominio

> Documento de control: cada fase tiene estado y criterio de salida.
> Estados: ⬜ pendiente · 🔶 en progreso · ✅ completo
>
> Creado: 2026-06-11 · Sesión de diseño PAAE
> Antecesor: `mejorar-de-diseno.md` (fases 1-4 completas)

---

## Visión

El framework es **multi-agente genérico en el corazón**. Cada dominio — coding incluido —
es un vertical huésped, no el dueño de la casa.

```
                    agent-core  (mecanismos genéricos, cero vocabulario de dominio)
                    engine · delegación · tools · MCP client · workflows · gates · audit
                         │
        ┌────────────────┼────────────────────┐
        │                │                    │
  agent-coding     agent-enterprise      (futuros verticales)
  vertical de      vertical de negocio
  codificación     flujos declarativos, broker,
                   policies-in-vault, compliance
        │                │
        ▼                ▼
   bk-agent CLI     Despliegue PAAE por empresa
   (producto)       (agentes + flujos + políticas = DATOS, no código)
```

### Regla de oro

> **Core aporta mecanismos; los verticales aportan vocabulario.**
> Todo lo específico del negocio es un artefacto declarativo (datos).
> La plataforma es un intérprete de esos artefactos.

**Test de agnosticismo:** agregar un flujo nuevo para una empresa = un YAML +
notas de política en el vault + (si hay sistema nuevo) un servidor MCP.
Si requiere tocar el kernel, el diseño está mal.

### Deuda conocida (no bloquea, define dirección)

- `agent-core` tiene fuga de vocabulario coding: FSM con estados `design_review`/`qa_review`
  cableados, `intent-detector` con acciones de programación. **No se refactoriza big-bang**:
  ni una línea de vocabulario nuevo entra a core; lo existente baja a `agent-coding`
  cuando se toque ese código.

---

## Decisiones de diseño (mini-ADRs)

### ADR-1 — Broker para transporte, vault para memoria
El vault NO es bus de eventos (polling lento, sin acks/retries/DLQ, locks manuales,
fan-out manual). El broker (BullMQ sobre Redis, ya integrado en `TriggerBus.addQueue`)
transporta; el vault registra (auditoría + RAG). Consistencia dual se resuelve con
agente barredor de reconciliación, no con outbox transaccional.

### ADR-2 — Flujos como datos (lección del design-agent)
`design-agent` (backendkit-agents) demostró que fases-como-datos funciona:
`design_init` recibe `phases[]` arbitrarias con criterios. Se generaliza ese modelo:
stages configurables en vez de `spec/implement/verify` cableados.

### ADR-3 — Cumplimiento verificable (gaps del design-agent corregidos)
El design-agent tiene 4 agujeros descalificantes para enterprise:
1. `passed=true` auto-reportado por el mismo agente que ejecuta
2. Criterios decorativos — nunca se evalúan individualmente ni quedan marcados
3. `notes` texto libre — sin vínculo a evidencia verificable
4. `design_edit` fuerza `status: complete` sin entrada en el log (bypass silencioso)

Correcciones obligatorias en PAAE:
- Evaluador ≠ ejecutor (otro agente o humano vía `ApprovalGate`)
- `passed` por criterio con campo `evidence` obligatorio
- Log append-only: TODA mutación de estado escribe al log
- Estado y transiciones en el vault (`/auditoria/`), no en homedir

### ADR-4 — Políticas en el vault, no en prompts
Las reglas de negocio (matrices de aprobación, umbrales) viven como notas en
`/politicas/` consultadas por RAG. El prompt instruye "consultá la política vigente",
no la contiene. La empresa edita markdown → el comportamiento cambia sin deploy.
Git sobre el vault = auditoría de cambios de política.

### ADR-5 — El motor de flujos incuba en agent-enterprise
El flow engine es mecanismo (candidato a core), pero se incuba en `agent-enterprise`
y se promueve a core solo cuando un segundo vertical lo necesite. Misma regla de
fase 4: el uso real decide qué se consolida.

---

## Fase 1 — Motor de flujos declarativos ⬜

**Objetivo:** flujos de negocio definidos en YAML, interpretados sobre
`WorkflowBuilder`/`WorkflowRunner` (core, stable). La pieza que fija el patrón
de todo el vertical.

### FlowDefinition (esquema propuesto)

```yaml
# flows/onboarding-empleado.yaml
flow: onboarding-empleado
version: 1
trigger:
  type: queue                  # queue | webhook | cron | manual
  queue: eventos.contratacion
steps:
  - id: preparar-ficha
    agent: rrhh
    prompt: "Prepara la ficha del empleado en Odoo con los datos del evento: {{payload}}"
    tools: [odoo_employee_create, search_knowledge, write_knowledge]
    gate:
      criteria:
        - "Ficha creada en Odoo con legajo asignado"
        - "Nota canónica escrita en /eventos"
      evaluator: auditor       # agente DISTINTO al ejecutor
      evidence: required
  - id: bienvenida
    agent: onboarding
    after: [preparar-ficha]
    prompt: "Envía el email de bienvenida vía n8n"
    tools: [n8n_trigger, search_knowledge]
  - id: preliquidacion
    agent: nomina
    after: [preparar-ficha]
    gate:
      approval: human          # ApprovalGate → email n8n + webhook de respuesta
compensation:
  - on: preliquidacion.failed
    agent: nomina
    prompt: "Revierte la preliquidación y documenta el motivo en /auditoria"
```

### Entregables
- [ ] Tipos `FlowDefinition`, `FlowStep`, `FlowGate` + schema Zod de validación
- [ ] `FlowLoader`: YAML → validación → `WorkflowBuilder`
- [ ] `FlowRunner`: ejecución con resolución de `after` (DAG simple), interpolación
      de `{{payload}}`, registro de cada transición
- [ ] Soporte `compensation` (pasos de reversa on-failure)
- [ ] Tests: carga válida/inválida, DAG con paralelos, compensación

### Criterio de salida
Un flujo de 3 pasos con dependencias se define SOLO en YAML y corre end-to-end
con agentes mock. Cero código específico del flujo.

---

## Fase 2 — ComplianceGate: cumplimiento verificable ⬜

**Objetivo:** gates de cumplimiento con evidencia por criterio y separación
ejecutor/evaluador. Generaliza el modelo del design-agent corrigiendo sus gaps (ADR-3).

### Modelo

```typescript
interface GateCriterion {
    id: string;
    description: string;
    passed?: boolean;
    evidence?: string;        // obligatorio si evidence: required — path, output, referencia
    evaluatedBy?: string;     // agentId del evaluador (≠ ejecutor, validado)
    evaluatedAt?: string;
}

interface GateRecord {
    stepId: string;
    flowId: string;
    executor: string;
    criteria: GateCriterion[];
    verdict: 'passed' | 'failed' | 'pending';
    log: GateLogEntry[];      // append-only — TODA mutación escribe aquí
}
```

### Entregables
- [ ] `ComplianceGate`: evalúa criterios uno a uno, valida evaluador ≠ ejecutor
- [ ] Persistencia de `GateRecord` en el vault (`/auditoria/{flow}/{run}/gates.md`)
      vía `VaultWriter` — versionable, RAG-consultable
- [ ] Integración con `ApprovalGate` de core para `approval: human`
- [ ] Log append-only: no existe API de mutación que no registre
- [ ] Tests: rechazo de auto-evaluación, evidencia faltante, bypass imposible

### Criterio de salida
Un gate con 3 criterios solo pasa cuando un agente distinto al ejecutor marca
cada criterio con evidencia. El intento de auto-aprobar falla con error explícito.
El registro completo queda en el vault.

---

## Fase 3 — Eventos por broker ⬜

**Objetivo:** comunicación entre agentes por BullMQ (ADR-1). El vault deja de ser
disparador y pasa a ser memoria/auditoría.

### Flujo

```
Productor (ATS / humano / agente)
  ├─ 1. publica evento en cola BullMQ      ← transporte (ms, acks, retries, DLQ)
  └─ 2. escribe nota canónica en /eventos  ← auditoría + RAG

Consumidores → TriggerBus.addQueue (ya existe, agent-web fase 8)
  └─ al terminar escriben resultado en /auditoria
```

### Entregables
- [ ] `EventSchema`: tipos de evento declarados con JSON schema, validados al publicar
- [ ] `EventPublisher`: helper que hace publish + nota canónica en una llamada
- [ ] Convención de colas: `eventos.{tipo}` con DLQ por cola
- [ ] Agente barredor de reconciliación: compara eventos publicados vs notas
      en `/auditoria`, alerta huérfanos (consistencia eventual, sin outbox)
- [ ] Tests con Redis local: publish/consume, retry, DLQ, reconciliación

### Criterio de salida
Un evento publicado dispara N consumidores en paralelo; si uno estaba caído,
lo procesa al volver (retry de BullMQ). El barredor detecta un evento sin nota
de auditoría inyectado a propósito.

### Nota de gobernanza
`TriggerBus` está marcado `experimental — frozen`. Esta fase es el caso de uso
real que justifica promoverlo a `stable` (regla de fase 4: el piloto decide).

---

## Fase 4 — Policies-in-vault ⬜

**Objetivo:** sacar las reglas de negocio de los prompts (ADR-4).

### Entregables
- [ ] Convención `/politicas/{dominio}/{regla}.md` con frontmatter
      (`vigente_desde`, `aprobada_por`, `version`)
- [ ] Refactor de los 6 perfiles de `agent-enterprise`: la matriz de aprobación
      de `finance` y similares salen del prompt; el prompt instruye consultar
      la política vigente con `search_knowledge`
- [ ] Notas de política seed para el piloto (aprobaciones, escalamiento, privacidad)
- [ ] Test de comportamiento: cambiar la nota de política cambia la decisión
      del agente sin redeploy

### Criterio de salida
`grep` de umbrales/montos/matrices en los system prompts de los perfiles → cero
matches. El agente finance responde según la política del vault, y al editarla
responde distinto.

---

## Fase 5 — Conectores de integración ⬜

**Objetivo:** las integraciones externas como servidores MCP + tool n8n.
Patrón ya probado en `mcp-connectors` (HubSpot, Jira, GCal).

### Entregables
- [ ] Servidor MCP **Odoo** (módulos empleados + nómina): `odoo_employee_create`,
      `odoo_employee_get`, `payroll_prepare`, `payroll_confirm`
      — mismo patrón de auth por env vars, binarios stdio/HTTP,
      y el fix conocido del hang de TypeScript (`t = srv.tool.bind(srv) as any`)
- [ ] Tool `n8n_trigger`: POST a webhook de n8n con payload + correlation id
- [ ] Documentación de cada conector (env vars, ejemplos)

### Criterio de salida
Un agente crea un empleado en Odoo de pruebas vía MCP y dispara un workflow
n8n real, ambos desde el REPL del piloto.

---

## Fase 6 — Piloto PAAE end-to-end ⬜

**Objetivo:** el flujo de onboarding completo definido SOLO con datos.
Es el test de agnosticismo del framework.

### Entregables
- [ ] `flows/onboarding-empleado.yaml` (fase 1) corriendo con agentes reales
- [ ] Agentes definidos como pares `.json` + `.md` (mecanismo existente de `GlobalSeed`)
- [ ] Políticas en el vault (fase 4)
- [ ] Evento de contratación → broker → RRHH → [bienvenida ∥ preliquidación] →
      aprobación humana → confirmación → auditoría completa en el vault
- [ ] Spike de calidad LLM: mismo flujo con `llama3.2:3b` local vs DeepSeek,
      mismo vault — documentar veredicto en el vault

### Criterio de salida
Definir un SEGUNDO flujo distinto (ej. solicitud de compra) toma < 1 día y
requiere: 1 YAML + notas de política + cero código de plataforma.
Si requiere tocar el kernel → volver a fase 1 y corregir el diseño.

---

## Secuencia y dependencias

```
Fase 1 (flujos) ──→ Fase 2 (compliance) ──→ Fase 6 (piloto)
                                              ▲
Fase 3 (broker) ──────────────────────────────┤
Fase 4 (policies) ────────────────────────────┤
Fase 5 (conectores) ──────────────────────────┘
```

Las fases 3, 4 y 5 son independientes entre sí y pueden avanzar en paralelo
con la 1-2. La fase 6 integra todo.

| Fase | Alcance | Esfuerzo relativo | Estado |
|---|---|---|---|
| 1. Motor de flujos declarativos | FlowDefinition + loader + runner | ●●●○ | ⬜ |
| 2. ComplianceGate | Evidencia + separación de roles + vault | ●●○○ | ⬜ |
| 3. Eventos por broker | Schemas + publisher + barredor | ●●○○ | ⬜ |
| 4. Policies-in-vault | Convención + refactor perfiles | ●○○○ | ⬜ |
| 5. Conectores | MCP Odoo + tool n8n | ●●○○ | ⬜ |
| 6. Piloto PAAE | Onboarding end-to-end + spike LLM local | ●●○○ | ⬜ |

---

## Registro de progreso

| Fecha | Fase | Avance |
|---|---|---|
| 2026-06-11 | — | Documento creado. Diseño acordado en sesión (broker, flujos declarativos, compliance verificable, policies-in-vault, lecciones del design-agent). |
