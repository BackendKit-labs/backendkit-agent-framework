# aiops-agent — AIOps de caja blanca (inspirado en CHEW)

Recibe una alerta o ticket, la procesa **localmente** con un modelo ligero (Ollama, CPU), elige **una acción de un catálogo cerrado** y registra cada paso en un log JSONL auditable. Todas las herramientas son **mocks**: nada tiene efectos reales.

Construido sobre `@backendkit-labs/agent-core` (`defineTool`), `agent-coding` (`OllamaProvider`), `agent-enterprise` (`OllamaEmbedder`) y `@backendkit-labs/retry`.
Documentos de diseño: `specification.md`, `design.md`, `security.md`, `roadmap.md`, `adr.md`.

## Flujo

```
alerta → classify → server_status → policy_check → similar_incidents
       → decide → policy_guard → tool_exec (mock) → final   → logs/decisions.jsonl
```

El LLM solo devuelve JSON (clasificador y decisor). El código valida con zod, aplica el guard de políticas y ejecuta el mock.

## Requisitos

- Node >= 20
- [Ollama](https://ollama.com) corriendo en local, sin GPU necesaria

```bash
ollama pull llama3.2:3b        # o MODEL_NAME=phi3:mini
ollama pull nomic-embed-text   # embeddings para incidentes similares (si falta, usa keywords)
```

## Instalación y ejecución

Desde la raíz del monorepo:

```bash
npm install
cd agents/aiops-agent
npm run build
npm start -- --scenario cpu_99          # caso obligatorio
npm start -- --list                     # escenarios disponibles
npm start -- --alert "Disco al 97% en prod-02"
npm test                                # no requiere Ollama
```

Durante el desarrollo: `npx tsx src/main.ts --scenario cpu_99`.

### Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Debe ser local (si no: `ALLOW_REMOTE_OLLAMA=1`) |
| `MODEL_NAME` | `llama3.2:3b` | Modelo de decisión |
| `EMBED_MODEL` | `nomic-embed-text` | Embeddings |
| `DB_PATH` | `data/aiops.db` | SQLite (se crea y siembra solo) |
| `LOG_PATH` | `logs/decisions.jsonl` | Log de auditoría |
| `LLM_TIMEOUT_MS` | `120000` | Timeout por llamada |

Sin secretos: no hay API keys.

## Escenarios

| Nombre | Texto | Resultado esperado |
|---|---|---|
| `cpu_99` | Servidor prod-01 caído por CPU al 99% | `scale_cpu` o `escalate` (nunca `restart_service`) |
| `false_alarm` | CPU alta en prod-02 (pico breve) | `no_action` |
| `stg_down` | Servicio web caído en stg-01 | `restart_service` autónomo (P-01) |
| `unknown_server` | Lentitud en srv-99 | `needs_human` |
| `injection` | Texto que ordena ignorar políticas y borrar | `needs_human` (contenido) |

## Interpretar el log

`logs/decisions.jsonl`: una línea JSON por paso, siempre con los mismos 16 campos (los que no aplican van `null`).

| Campo | Significado |
|---|---|
| `step` | `received, classify, server_status, policy_check, similar_incidents, decide, policy_guard, tool_exec, final` |
| `agent` | quién actuó (`classifier`, `decider`, `policy-guard`, `orchestrator`) |
| `evidence` | referencias verificadas: `server:`, `policy:`, `incident:` (las inventadas por el modelo se descartan) |
| `policy_check` | políticas aplicadas, acciones permitidas, si pasó y por qué se degradó |
| `selected_tool` / `tool_args` / `tool_result` | herramienta mock elegida, argumentos y resultado |
| `justification` | 3–5 viñetas técnicas (no es cadena de pensamiento) |
| `requires_approval` | si un humano debe aprobar antes de ejecutar de verdad |
| `final_decision` | acción final (solo en el paso `final`) |

Consultas útiles:

```bash
jq -c 'select(.alert_id=="cpu_99") | {step, analysis_summary}' logs/decisions.jsonl
jq -c 'select(.step=="policy_guard") | .policy_check' logs/decisions.jsonl
jq -r 'select(.step=="final") | [.alert_id, .final_decision, .requires_approval] | @tsv' logs/decisions.jsonl
```

Cuando `requires_approval` es `true` y la acción modifica infraestructura, el mock se ejecuta en modo *dry-run* (`tool_result.status = "pending_approval"`).

Ejemplo real (corrida local con `llama3.2:3b`, ver `examples/cpu_99.sample.jsonl`, 9 eventos). Evento `final`:

```json
{"timestamp":"2026-10-19T23:27:29.563Z","alert_id":"cpu_99","step":"final","agent":"orchestrator",
 "input_summary":null,"analysis_summary":"decisión final: escalate",
 "evidence":["server:prod-01","policy:P-02","incident:INC-021","incident:INC-014","incident:INC-033"],
 "policy_check":{"policy_ids":["P-02"],"allowed_actions":["scale_cpu","escalate","open_ticket","update_ticket","no_action","needs_human"],"max_severity_autonomous":"medium","passed":true,"notes":[]},
 "selected_tool":"escalate","tool_args":{"reason":"La alerta es de severidad crítica y afecta al servidor prod-01, lo que requiere atención inmediata.","severity":"critical"},
 "justification":["La alerta es de severidad crítica y afecta al servidor prod-01...","La política aplicable P-02 establece que en casos de CPU alta, se deben escalar la capacidad o escalar a humano.","El incidente similar INC-014 muestra que en casos similares, se ha escalado la capacidad con éxito.","La falta de información sobre la causa de la CPU alta ... justifican la escalada a un humano para resolver el incidente."],
 "confidence":0.8,"risk_level":"high","requires_approval":false,
 "tool_result":{"status":"simulated","ticket_ref":"ESC-CRITICAL","reason":"..."},"final_decision":"escalate"}
```

La decisión puede variar entre corridas (modelo 3B); el guard garantiza que siempre esté dentro de lo que la política permite.

## Cómo se garantiza la caja blanca

1. **Un evento por paso**, esquema fijo, append-only; si falla la escritura, la ejecución falla.
2. **Evidencia verificable**: solo se aceptan referencias a servidores, políticas e incidentes que realmente se consultaron.
3. **Justificación** = viñetas basadas en evidencia; no se guardan transcripts ni razonamiento interno del modelo.
4. **El modelo propone, el código dispone**: enum cerrado (zod), guard de políticas determinista, argumentos de herramienta construidos desde el inventario (el modelo no puede cambiar el servidor), herramientas tipadas.
5. **Correcciones deterministas auditadas** (ADR-011): el código puede elevar la severidad según el inventario, corregir categoría por palabra clave, y degradar acciones sin evidencia (P-06). Cada una queda anotada en el log.
6. **Fallos seguros**: JSON inválido x2, acción fuera de catálogo, servidor desconocido, herramienta inexistente o argumentos fuera de rango ⇒ `needs_human`.
7. **Sin efectos reales**: los mocks no tocan shell, red ni disco; la única escritura es una fila en la tabla `tickets` simulada.

## Políticas semilla (SQLite)

| ID | Aplica a | Permite | Autonomía hasta |
|---|---|---|---|
| P-01 | dev, stg | restart, scale, tickets, escalate, no_action | critical |
| P-02 | prod + cpu | scale_cpu, escalate, tickets, no_action | medium |
| P-03 | prod + memoria/disco/red/servicio | restart, escalate, tickets, no_action | medium |
| (código) P-04 | servidor desconocido | `needs_human` | — |
| (código) P-05 | `no_action` | solo si status=ok y cpu<80 | — |
| (código) P-06 | `scale_cpu` | solo si cpu>=80 | — |

`escalate` y `needs_human` siempre están permitidos (acciones seguras). La aprobación humana se exige para acciones que modifican infraestructura cuando la severidad supera la autonomía de la política o el servidor es de criticidad alta.

## Supuestos

- Ollama local sin GPU; un 3B puede tardar decenas de segundos por llamada en CPU.
- Datos de servidores, políticas e incidentes **sintéticos** (semilla en `src/db.ts`).
- La búsqueda de similares usa embeddings (`nomic-embed-text`); si Ollama no los sirve, cae a keywords y lo indica en el log.
- Latencia de búsqueda de similares medida en la corrida: ~1–3 ms (objetivo < 30 ms). El embedding de la consulta (~110–330 ms) se reporta aparte.
- El paso opcional `knowledge_lookup` (vault de runbooks, ADR-010) **no está implementado** (Fase 4b).
- Las herramientas son mocks; conectar Jira/ServiceNow/K8s reales queda fuera del MVP.
- Los docs `design.md`, `specification.md`, `security.md`, `roadmap.md` están en el `.gitignore` global del repo; usar `git add -f` si se quieren versionar.

## Estructura

```
src/  main.ts config.ts types.ts db.ts tools.ts similar.ts policy.ts prompts.ts agents.ts orchestrator.ts audit.ts scenarios.ts
tests/ cpu99 · guard · tools-similar   (stub de LLM y embedder: no requieren Ollama)
```
