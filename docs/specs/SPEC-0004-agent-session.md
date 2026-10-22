# SPEC-0004: agent-session — log de sesión orientado a eventos

**Fecha:** 2026-10-22
**Estado:** Borrador
**Inspiración:** `core/session`, `session-persistence*`, `session-checkpoint-policy`, `session-projection`, `session-query*` de deepseek-harness (diseño, no código).
**Habilita:** hijos continuables y fork (SPEC-0005), goals y recordatorios durables (SPEC-0007), Hermes completo (SPEC-0003 H3), ejecución durable y evals con replay.

## 1. Problema verificado
El historial de una conversación es `HistoryManager`: un array de mensajes en memoria, persistido como JSON (tope 100) y mutado con `replaceAll` (compactación de la Ola 2). No hay eventos, ni replay, ni fork, ni recuperación de un run interrumpido, ni versionado del formato. `checkpoint` guarda resúmenes en markdown para personas. `auditLog` solo registra llamadas a tools.

## 2. Objetivos y no objetivos
### Objetivos
1. Una sesión es un **log append-only de eventos tipados**; el historial que ve el modelo se **deriva** del log.
2. Persistencia intercambiable (JSONL comprimido por defecto) con barrera de durabilidad explícita.
3. **Checkpoint antes de efectos:** persistir antes de cada petición al modelo y antes de cada herramienta con efectos externos; si falla, no se ejecuta (fail-closed). Recuperar tras una caída con el resultado de una herramienta interrumpida como `unknown`, sin reintento automático.
4. Proyecciones incrementales (estadísticas, presión de contexto, todos, goal) sin releer el log.
5. Fork (copia del prefijo) y resume.
6. Formato versionado con migraciones adyacentes `vN → vN+1`.
7. Consulta: listar, filtrar, leer y buscar (FTS opcional).
### No objetivos
UI, multi-escritor entre procesos, replicación remota.

## 3. Modelo
```ts
export type SessionEvent =
  | { t: 'turn/start'; id: string; at: number }
  | { t: 'user/message'; content: string; attachments?: AttachmentRef[] }
  | { t: 'system/message'; content: string }
  | { t: 'request/start'; step: number; agentId: string; model?: string; messageCount: number }
  | { t: 'assistant/message'; content: string | null; toolCalls?: ToolCallRecord[]; usage?: Usage; raw?: unknown }
  | { t: 'assistant/attempt'; outcome: 'failed' | 'aborted' | 'retried'; error?: string }
  | { t: 'tool/call'; id: string; name: string; args: string; agentId: string }
  | { t: 'tool/result'; id: string; result: string; success: boolean; outcome?: 'timeout' | 'aborted' | 'unknown' }
  | { t: 'context/compaction'; replaces: [fromSeq: number, toSeq: number]; summary: string }
  | { t: 'guardrail'; name: string; phase: string; action: string; reason: string }
  | { t: 'turn/end'; reason: 'done' | 'aborted' | 'error' | 'budget' };
```
Regla: **todo lo que el modelo ve queda en el log** (incluidos resúmenes de compactación, avisos de jobs y contexto inyectado). `deriveMessages(events)` es una función pura y determinista.

### 3.1 Compactación como evento
`ContextManager` deja de mutar el historial: emite `context/compaction` y `deriveMessages` aplica el reemplazo. El log conserva los originales (poda reversible y auditable), lo que arregla que hoy el original se pierde.

### 3.2 Recuperación
Al abrir una sesión con un `turn/start` sin `turn/end`: se sella el turno (`turn/end` reason `error`), las `tool/call` sin `tool/result` reciben `tool/result` `{ success: false, outcome: 'unknown' }` y se informa al modelo en el siguiente turno de que el resultado se desconoce.

## 4. Paquete y API
`packages/session` → `@backendkit-labs/agent-session`.
```ts
interface SessionStore {                      // backend
    create(meta): Promise<SessionHandle>;
    open(id, { write: boolean }): Promise<SessionHandle>;
    list(filter?): Promise<SessionMeta[]>;
}
interface SessionHandle {
    append(ev: SessionEvent): number;         // síncrono en memoria; devuelve seq
    flush(): Promise<void>;                   // barrera de durabilidad
    events(from?: number): Iterable<SessionEvent>;
    messages(): LLMMessage[];                 // deriveMessages cacheado
    project<T>(key: ProjectionKey<T>): T;
    fork(atSeq?: number): Promise<SessionHandle>;
    close(): Promise<void>;
}
```
Backend de referencia `JsonlSessionStore({ dir, compress })`: un archivo `session.vN.jsonl[.zst]` por sesión, escritura atómica de cabecera, un escritor por sesión (candado), cola truncada reparada al abrir. Backend en memoria para pruebas.

### 4.1 Integración con `AgentEngine`
`EngineOptions.session?: SessionStore | SessionHandle`. Si se pasa, `HistoryManager` pasa a ser una **vista** del handle (misma interfaz `push/getAll/sanitized/trim/save/clear`), de modo que el resto del engine cambia poco. `historyPath` sigue funcionando: se importa el JSON existente como sesión v0 la primera vez (adaptador `JsonHistoryImporter`) y se deja de escribir. Un `checkpointPolicy` (activo por defecto con `session`) hace `flush()` antes de `chat()` y antes de `executeToolCall` de herramientas no `concurrencySafe`.

### 4.2 Proyecciones y consulta
Proyecciones de serie: `stats` (turnos, tokens, coste, tiempos), `contextPressure` (usa el estimador de `ContextManager`), `turnOutline`. Registro de proyecciones del usuario. `SessionQuery` con lectura exacta y filtros; búsqueda de texto completo opcional con SQLite FTS5 en un paquete aparte (`agent-session-sqlite`) para no obligar a una dependencia nativa.

### 4.3 Migraciones
Cada cambio de esquema añade un paso `vN → vN+1` puro (streaming); `open` aplica la cadena en memoria y, solo en apertura de escritura, publica el sucesor `session.vN+1` sin tocar el original. Las versiones publicadas nunca se renombran ni se borran. Un test de "fixtures congelados" por versión.

## 5. Compatibilidad
Opt-in. Sin `session`, el engine usa `HistoryManager` como hoy. Cambio de versión menor en `agent-core` (vista del historial) y paquete nuevo. `agent-web`/`SessionManager` aprovechan `list/open` para reabrir sesiones.

## 6. Pruebas y aceptación
- `deriveMessages` es determinista y equivale al historial del engine en las pruebas existentes de `AgentEngine` (se ejecutan con y sin `session`).
- Caída simulada (matar el proceso entre `tool/call` y `tool/result`): al reabrir, el run se recupera sin pares huérfanos y con `unknown`.
- `flush` fallido antes de una herramienta con efectos → la herramienta no se ejecuta.
- Fork en la mitad de un turno produce un historial válido para el provider.
- Migración v0 (JSON actual) → v1 con fixtures reales; formato futuro rechazado con error claro.
- Rendimiento: abrir una sesión de 10 000 eventos < 150 ms; `append` + proyección O(1) amortizado.
- Replay: un `ReplayProvider` (SPEC-0007) reproduce una sesión grabada y obtiene el mismo historial final.

## 7. Riesgos y decisiones abiertas
- **Es el cambio más invasivo del roadmap:** toca `runLoop`, `runAgentInternal` (usa `history.getAll()` para el contexto de sub-agentes) y `ContextManager`. Mitigación: la vista compatible `HistoryManager` y una rama larga con la batería de pruebas actual como red.
- **Costo del checkpoint fail-closed en latencia:** `flush` por petición; el backend JSONL agrupa escrituras y `fsync` solo en la barrera. Medir antes de activarlo por defecto.
- **Decisión propuesta:** compresión zstd opcional (dependencia nativa) → por defecto gzip de Node (`zlib`).
- **Pregunta:** ¿unificar `auditLog`, `MetricsSnapshot` y spans como proyecciones del log? Propuesta: sí, pero después de H1.
