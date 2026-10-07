# Director Proactivo — diseño

> Objetivo: que el director no espere trabajo. Que se despierte solo, mire el
> estado del mundo **según quién es el usuario al que sirve**, y empuje valor
> (o silencio, si no hay nada) — sin convertirse en un proceso desatendido que
> gasta LLM y toca sistemas sin control.

## 1. Qué existe hoy (y se reutiliza)

| Pieza | Estado | Rol en este diseño |
|---|---|---|
| `RunWatcher` (`src/run-watcher.ts`) | ✅ en prod | Único comportamiento proactivo actual: vigila runs del coder y empuja al WS. Es el precedente del patrón push. |
| `connectionsByUser` + `setNotifier` (`ws-server.ts`) | ✅ | Canal push por-principal, independiente del turno de chat. El loop proactivo publica por acá. |
| `Principal` (`auth/types.ts`) | ✅ | `id`, `role`, `roles[]`, `department` — el perfil que decide QUÉ mirar para cada usuario. |
| `SessionEngineManager` (`engine.ts`) | ✅ | Un engine por principal con su memoria/historial. El pulso corre en el engine del usuario, no en uno global. |
| `PolicyEngine` + `vault_visibility` (`director.yaml`) | ✅ | Ya filtra tools y vault por rol. El turno proactivo pasa por el MISMO filtro — no hay bypass. |
| `notifier` agent (multi-canal) | ✅ conectado | Entrega cuando el usuario no tiene WS abierto (email/Slack/Telegram). |
| `schedule-agent` | ✅ conectado | Hoy dispara flows del orquestador, no prompts del director. Trigger externo en Fase 3. |
| `health-checker`, `finance`, `codex`, `runs` | ✅ conectados | Las fuentes de señal que el pulso consulta. |

## 2. Idea central: el Pulso

Un **PulseScheduler** in-process (en `SharedInfra`, junto al `RunWatcher`) que
cada N minutos, por cada usuario suscripto, ejecuta un **turno sintético** en
el engine de ese usuario con un prompt de playbook según su perfil.

```
      ┌────────────── PulseScheduler (timer in-process) ──────────────┐
      │  por cada suscripción activa:                                 │
      │    principal ──► playbook(rol) ──► turno sintético en su      │
      │    engine (mismas tools, mismo PolicyEngine, mismo vault      │
      │    filter) ──► ¿hay algo que valga la pena?                   │
      │        ├── NO → sentinel [SILENCIO] → no se publica nada      │
      │        └── SÍ → push WS (online) / notifier (offline)         │
      └───────────────────────────────────────────────────────────────┘
```

**Por qué turno sintético y no un servicio aparte:** el valor del director es
que ya tiene las tools, el contexto del vault, la memoria del usuario y las
políticas por rol. Duplicar eso en un "monitor" separado significa mantener
dos cerebros. El pulso es literalmente "alguien le preguntó al director qué
hay de nuevo" — solo que ese alguien es un timer.

**Identidad: el pulso corre COMO el usuario, nunca como admin.** Usa
`SessionEngineManager.get(principal)` con el principal real. Consecuencia
directa: el digest de un usuario `finance` no puede leer `infra/` del vault ni
llamar tools de deploy, porque `PolicyEngine`/`VaultFilter` ya lo impiden. La
proactividad hereda el control de acceso gratis.

## 3. Playbooks por perfil

Nueva sección en `director.yaml`. El playbook se resuelve por
`principal.role` (fallback: `default`). Cada playbook es un prompt de sistema
para el turno sintético + parámetros de cadencia.

```yaml
proactive:
  enabled: true
  quiet_hours: { from: "20:00", to: "07:00" }   # nunca molestar de noche
  max_iterations: 6        # presupuesto LLM por pulso (vs 20 del chat normal)
  playbooks:
    finance:
      every: 4h
      prompt: |
        Sos el pulso proactivo para un usuario de finanzas. Revisá:
        1. KPIs y flujo de caja del período actual (tools de finance/erp__).
        2. Desviaciones presupuesto vs real > 10% — eso es alerta, no digest.
        3. Vencimientos impositivos próximos (vault finanzas/, tax summary).
        Si NO hay nada nuevo ni accionable respondé exactamente [SILENCIO].
        Si hay algo, un resumen de máx 5 líneas, lo urgente primero.
    dev:
      every: 30m
      prompt: |
        Pulso proactivo para un dev. Revisá:
        1. Runs del coder en waiting_gate o failed (orchestrator_status).
        2. Salud del ecosistema si algo falló (health).
        Solo runs del usuario. Sin novedades → [SILENCIO].
    devops:
      every: 15m
      prompt: |
        Pulso para devops: snapshot de health-checker. Servicios caídos o
        degradados → alerta con el detalle. Todo sano → [SILENCIO].
    admin:
      every: 8h
      prompt: |
        Resumen ejecutivo del ecosistema: salud, runs activos, gates
        pendientes de todo el equipo. Sin cambios vs el último → [SILENCIO].
    default:
      every: off            # roles sin playbook no reciben pulso
```

**Suscripción, no imposición:** el pulso arranca cuando el usuario lo activa
("activá el modo proactivo" en el chat, o un toggle en la UI) y se persiste en
`~/.backendkit/director/proactive-subs.json`. Nadie recibe ruido que no pidió.

## 4. Anti-ruido: la parte más importante

Un agente proactivo que repite lo mismo cada 30 minutos se desactiva en un
día. Tres capas:

1. **Sentinel `[SILENCIO]`** — el playbook instruye a responder exactamente
   eso cuando no hay nada. El PulseScheduler lo detecta y no publica. El turno
   costó unas pocas llamadas de tool + 1 respuesta corta.
2. **Delta-hash** — se guarda un hash del último digest publicado por
   (usuario, playbook) en `proactive-state.json`. Si el nuevo digest normaliza
   al mismo hash, se suprime aunque el LLM no haya dicho [SILENCIO]. Doble
   protección contra el LLM "creativo" que reformula lo mismo.
3. **Cooldown de alertas** — una alerta idéntica (misma clave: ej.
   `run:xyz:failed`) no se repite antes de X horas, aunque siga vigente.

## 5. Rieles de seguridad

- **Solo lectura en Fase 1.** El turno proactivo lleva un flag
  `initiator: 'pulse'` en el `ExecutionContext`; `PolicyEngine` gana una
  condición global: con ese flag, toda tool mutante (deploy, curate,
  orchestrator_run, orchestrator_approve, reindex) se deniega. El pulso
  observa y reporta — no actúa.
- **Presupuesto duro:** `max_iterations` propio (6 vs 20), timeout por pulso,
  y tope diario de pulsos por usuario. Si un pulso revienta el presupuesto,
  se aborta y se loguea — no se reintenta hasta el próximo tick.
- **Quiet hours** globales + por playbook.
- **Auditoría:** cada pulso pasa por el `AuditLogger` existente (NDJSON) con
  `initiator: pulse`, igual que un turno normal. Nada invisible.
- **Kill switch:** `proactive.enabled: false` apaga todo sin redeploy
  (releer config), y cada usuario puede desuscribirse desde el chat.

## 6. De observar a actuar (fases)

**Fase 1 — Digest y alertas (solo lectura).**
`PulseScheduler` + playbooks + sentinel/delta + push WS. Todo lo de arriba.
Es la fase que valida si la señal es útil antes de darle manos.

**Fase 2 — Proponer con gate.**
El pulso puede terminar con una propuesta accionable:
> "El run `abc` está en waiting_gate hace 2h. ¿Apruebo? [Sí] [Ver detalle]"
La acción NO se ejecuta en el pulso: se registra como propuesta pendiente y
se ejecuta solo cuando el usuario responde (turno normal, con su política de
siempre). Mismo patrón de gates que ya usa el coder — humano en el loop.

**Fase 3 — Triggers externos y entrega offline.**
- `notifier` para usuarios sin WS abierto (el digest de finanzas por email a
  las 8am vale más que en un WS que nadie mira).
- `schedule-agent` como trigger: endpoint HTTP en el director
  (`POST /pulse/:userId`, autenticado) para que cron jobs externos disparen
  pulsos — desacopla la cadencia del proceso del director.

**Fase 4 — Auto-remediación acotada (opt-in por acción).**
Lista blanca explícita de acciones que el pulso puede ejecutar solo
(ej. reintentar un run fallido UNA vez, reindexar un vault stale de
madrugada). Cada una declarada en `director.yaml` con su condición, su tope
de frecuencia, y notificación post-hoc obligatoria. Nunca deploy, nunca
aprobar gates, nunca tocar datos de otro usuario.

## 7. Autenticación y autorización (análisis abac-service)

El pulso corre con la identidad del usuario, así que hay que entender de dónde
sale esa identidad y cuánto dura. Arquitectura actual en dos niveles:

- **abac-service** (`:3005`) emite JWT EdDSA (Ed25519, **8h**) con claims:
  `sub`, `email`, `org`/`orgSlug`, `appId`, `roles[]`,
  `permissions[]` (`resource:action`), `department`, `vaultResources`.
  También expone `POST /abac/can-access` / `batch-evaluate` (evaluación de
  políticas en runtime) y el flujo Entra ID (`validate-entra`, API key de
  servicio).
- **director-agent** verifica la firma **offline** (`ABAC_PUBLIC_KEY`) y hace
  todo el enforcement local contra `director.yaml` (RBAC → condiciones ABAC →
  vault_visibility → audit). Nunca llama a abac en runtime.

### Hallazgos que condicionan este diseño

| # | Hallazgo | Implicancia para el pulso |
|---|---|---|
| 1 | `/auth/admin/login` exige rol admin/super-admin — usuarios `finance`/`dev`/`devops` no podían loguearse con email/password al director. | **Resuelto**: abac ganó `POST /auth/login` (mismo flujo, sin exigir admin, pero exige ≥1 rol activo en la app; usuarios Entra ID siguen bloqueados del login local). El director ahora usa ese endpoint para todos (un admin lo pasa trivialmente). `type` del JWT refleja el rol real, no el endpoint. |
| 2 | `jwt.ts` no extraía `department` ni `vaultResources` del token (abac sí los emite). Condiciones por department evaluaban contra `''`; el override personal de vault estaba muerto. | **Corregido** (ver §8). Prerequisito para playbooks por department. |
| 3 | El WS captura el `Principal` una vez y nunca re-verifica — una conexión abierta sobrevive a la expiración del token (8h) con claims congelados. | Las suscripciones del pulso **no se rehidratan desde disco**: tras un reinicio quedan *pendientes de reactivación* hasta que el usuario se reconecte con un token válido. Nunca se serializa un `Principal`. TTL además por suscripción. |
| 4 | Claims stale por diseño: revocar un rol en abac no se propaga hasta re-login (ventana de 8h). | Aceptable para digest de solo lectura (Fase 1). Para acciones mutantes (Fase 4), re-validar contra `POST /abac/can-access` **antes de ejecutar** — el costo se paga solo en el camino excepcional. |
| 5 | `default_deny: false` — tools sin política quedan permitidas. | El turno `initiator: pulse` usa **allowlist**: solo tools explícitamente marcadas como seguras (lectura). Denegar-por-lista-negra dependería de mantener la lista completa a mano. |
| 6 | Sin `ABAC_PUBLIC_KEY` (dev/REPL) todo corre como `ADMIN_PRINCIPAL`. | El pulso solo se activa en modo enterprise (`isEnterpriseMode()`), igual que la autenticación misma. En dev se puede forzar con un flag explícito, sabiendo que corre como admin. |

## 8. Qué se toca (Fase 1) — ✅ implementado

| Archivo | Cambio |
|---|---|
| `src/auth/jwt.ts` | ✅ `verifyToken` extrae `department` y `vaultResources` del token (hallazgo #2). |
| `src/pulse-scheduler.ts` (nuevo) | ✅ Timer (tick 60s) + suscripciones + sentinel/delta/cooldown + TTL + quiet hours + estado en disco (solo `{userId, playbook}` — nunca el `Principal`). |
| `src/engine.ts` | ✅ `PulseScheduler` en `SharedInfra`; `createPulseEngine` (engine efímero por pulso: allowlist, sin memoria, presupuesto corto) + `runPulseTurn` (captura el output vía `onEvent` — `engine.run()` no retorna texto). |
| `src/ws-server.ts` | ✅ Notifier compartido con RunWatcher; comando `/pulse on\|off\|status` resuelto sin turno LLM; `reactivate()` en cada mensaje autenticado (renueva TTL); gating enterprise/`allow_dev` al arrancar. |
| `src/config.ts` | ✅ `ProactiveSchema` (zod) con allowlist global + por playbook. |
| `director.yaml` | ✅ Sección `proactive` con playbooks admin/dev/devops/finance sobre tools reales de los agentes conectados. |
| ~~`SOUL.md`~~ | **Desviación deliberada**: las instrucciones del modo pulso viven en `PULSE_MODE_SUFFIX` (engine.ts), apendeadas al system prompt SOLO en engines de pulso — editarlas en SOUL.md las cargaría también en cada turno de chat normal, que no las necesita. |

**Notas de implementación:**
- El turno de pulso corre en un engine efímero, no en el engine de chat del
  usuario — el prompt del playbook no contamina su historial de conversación.
- La allowlist se aplica registrando SOLO esas tools en el engine del pulso
  (lo que no está, no existe para el LLM); RBAC/ABAC/vault filter del usuario
  siguen aplicando encima vía los mismos guards del chat.
- Auditoría: cada pulso escribe una entrada `tool: __pulse__` con
  `{playbook, outcome: published|silence|duplicate|error}`, además de las
  entradas normales por cada tool call que el turno haga.
- El TTL se renueva con cada mensaje autenticado del usuario (no solo al
  reconectar): "actividad reciente" es lo que mantiene el pulso vivo.

## 8. Riesgos asumidos

- **Costo LLM:** cada pulso son llamadas reales. Mitigado por cadencias
  conservadoras, sentinel temprano y presupuesto corto — pero el costo real
  solo se conoce midiendo. El audit log da la telemetría para ajustar.
- **REPL:** el pulso solo tiene sentido en modo `serve` (WS). En REPL no se
  activa.
- **deepseek-reasoner** como modelo del pulso puede ser lento/caro para un
  digest; la sección `proactive` admite `provider:` override para usar un
  modelo más barato en pulsos que en chat.
