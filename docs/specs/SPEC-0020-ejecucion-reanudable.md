# SPEC-0020: ejecución reanudable

**Fecha:** 2026-11-16
**Estado:** Borrador. Decisiones D1-D5 con propuesta; sin implementar.
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) §6 (aprobación durable, opción A, hecha), [SPEC-0004](SPEC-0004-agent-session.md) (log de sesión, borrador) y [SPEC-0023](SPEC-0023-flujos-declarativos.md) (flujos).
**Tipo de cambio:** aditivo. Sin persistencia configurada, el comportamiento no cambia.
**Objetivo:** que un trabajo largo sobreviva a un reinicio del proceso sin repetir efectos externos, y que se sepa con certeza qué llegó a ejecutarse.

## 1. De dónde se parte

- La aprobación durable **ya existe** con la opción A (reenvío): `ApprovalStore` con `FileApprovalStore` (tres archivos por petición, publicados con un hard link que falla si el destino existe, así que cada paso es atómico y exclusivo entre procesos), decisión única, `markExecuted` como mucho una vez y `engine.runApproved(id)`. Cubre "la persona tarda horas".
- El historial es `HistoryManager`: un array en memoria que `save()` escribe a JSON **al terminar cada ejecución** (no durante ella), con tope de 100 mensajes. Una caída a mitad de un turno pierde ese turno. No hay log de eventos, ni replay, ni recuperación (SPEC-0004 §1).
- `ExecutionContext` (el contexto que recibe cada tool) trae `agentId`, `sessionId`, `principal` y `signal`; **no trae un id de ejecución, ni de llamada, ni clave de idempotencia**.
- La auditoría guarda solo el hash de los argumentos (`argsHash`); **no hay un redactor** que se pueda reutilizar para guardar entradas o salidas.
- `WorkflowRunner` guarda sus resultados solo en memoria (`results`, `completed`, `failed`): una caída a mitad de un flujo de diez pasos obliga a repetirlo desde el principio, incluidos los pasos que ya escribieron en un ERP. No ejecuta agentes él mismo: llama a un callback `runAgent(agentId, input, context, stepId)` que pone el integrador. Ese callback es el punto donde se engancha el journal.
- SPEC-0014 §6.1 descartó la opción B (suspender y reanudar el loop) "salvo que SPEC-0004 exista y aparezca un caso que el reenvío no cubra".

**El caso que el reenvío no cubre:** el proceso muere (despliegue, OOM, corte) con un flujo a medias o un turno con tools de efecto en curso. Eso ya no es una aprobación pendiente: es trabajo perdido, o peor, trabajo repetido.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿A qué granularidad se reanuda? | (a) el turno del engine, mensaje a mensaje; (b) el paso de un flujo; (c) ambas | **(b) primero.** Un paso es una unidad con entrada y salida claras y su resultado se guarda entero. Reanudar un turno exige reconstruir el historial y decidir qué hacer con una tool a medias (D3); eso es SPEC-0004 completo |
| D2 | ¿Dónde se guarda? | (a) interfaz `RunJournal` con implementación en archivo (escritura atómica); (b) reutilizar `ApprovalStore`; (c) esperar a `agent-session` | **(a).** Interfaz mínima en core. La implementación en archivo reutiliza la técnica de `FileApprovalStore` (publicar con hard link, que falla si existe) también para `claim`. Las de Postgres/Redis, a cargo del integrador. `agent-session` podrá implementarla después |
| D3 | ¿Qué pasa con una tool de efecto que estaba en curso al caer? | (a) reintentar; (b) darla por fallida; (c) marcarla `unknown` y no reintentar sin decisión | **(c).** Es la regla de SPEC-0004 §2. Reintentar un pago es peor que preguntar. El paso queda `interrupted` y una persona o una política decide |
| D4 | ¿Cómo se evita repetir un efecto? | (a) confiar en que la tool sea idempotente; (b) el engine pasa una clave de idempotencia estable por llamada (`runId:stepId:callId`); (c) ambas | **(c).** La clave la expone `ExecutionContext` (hoy no existe); las tools que escriben en un sistema externo la propagan. Sin ella, D3 manda |
| D6 | ¿Qué se guarda de las entradas y salidas, y quién lo protege? | (a) todo en claro; (b) un hook `redact` opcional; (c) solo hashes | **(b), sin valor por defecto.** Reanudar necesita la salida real de un paso `done`, así que (c) no sirve. El journal es tan sensible como el historial, que hoy se guarda en claro (`HistoryManager`). La documentación lo dice y `redact` queda a cargo del integrador. No se promete un saneo que el código no tiene |
| D5 | ¿Quién reanuda? | (a) automático al arrancar; (b) llamada explícita `resume(runId)` | **(b).** Reanudar sin que nadie lo pida repite trabajo en un proceso que quizá ya lo retomó otro (dos instancias). La llamada toma un cierre (lease) en el journal |

## 3. Diseño

```ts
type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'interrupted' | 'awaiting_approval';

interface RunRecord {
  runId: string; flow: string; tenantId?: string; startedAt: string;
  input: unknown;                       // pasa por `redact` si el integrador lo configura (D6)
  steps: Record<string, { status: StepStatus; output?: string; error?: string; attempt: number; at: string }>;
}

interface RunJournal {
  begin(rec: Omit<RunRecord, 'steps'>): Promise<void>;
  /** Guarda el cambio ANTES de ejecutar el paso (running) y DESPUÉS (done/failed). Falla cerrado: si no se puede escribir, el paso no corre. */
  step(runId: string, stepId: string, patch: StepPatch): Promise<void>;
  /** Toma el cierre de una ejecución; false si otro proceso la tiene vigente. */
  claim(runId: string, owner: string, ttlMs: number): Promise<boolean>;
  get(runId: string): Promise<RunRecord | undefined>;
  list(filter?: { status?: 'open' | 'closed'; flow?: string }): Promise<RunRecord[]>;
}
```

- Un paso `done` no se vuelve a ejecutar al reanudar; su salida alimenta a los pasos que dependen de él.
- Un paso `running` al reanudar pasa a `interrupted` y no se reintenta (D3). `resume(runId, { retry: ['stepId'] })` es la decisión explícita de reintentarlo.
- La entrada y las salidas se guardan tal cual, o tras `redact` si se configura (D6). El journal no promete ocultar secretos por sí solo.
- Aislamiento por tenant, como el resto de los almacenes.

## 4. Fases

- **F1. `RunJournal` y la implementación en archivo.** Con pruebas de escritura atómica y de `claim`. Sin tocar el engine.
- **F2. Reanudar flujos.** `WorkflowRunner` (y el runner único de SPEC-0023) escribe y lee el journal. Test de aceptación: se mata el proceso entre el paso 3 y el 4 de un flujo de 5; al reanudar se ejecutan 4 y 5, y 1-3 no se repiten.
- **F3. Clave de idempotencia en `ExecutionContext`.** Campo nuevo y opcional (`idempotencyKey`), presente cuando hay `runId`. Test: la misma llamada reanudada lleva la misma clave.
- **F4. Aprobación como estado del journal.** `awaiting_approval` enlaza con el `ApprovalStore` de SPEC-0014: aprobar reanuda el paso; no hace falta un segundo mecanismo.
- **F5 (condicionada).** Reanudar un turno del engine. Solo si SPEC-0004 se aprueba y un caso real lo pide.

## 5. Criterios de aceptación

- Matar el proceso en cualquier punto de un flujo no repite un paso `done` ni reintenta un efecto en curso.
- Dos procesos no reanudan el mismo `runId` a la vez.
- Con `redact` configurado, el journal no contiene lo que ese hook oculta.
- Sin `RunJournal` configurado, ningún comportamiento cambia.

## 6. Fuera de alcance

- Un motor de workflows durable completo (temporizadores, señales, versionado de definiciones en vuelo): es el terreno de Temporal. Si un caso lo exige, el integrador implementa `RunJournal` sobre él.
- Reanudar el streaming de un turno a medias.
- Replicación entre regiones.
