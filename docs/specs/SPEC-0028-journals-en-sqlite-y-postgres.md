# SPEC-0028: `RunJournal` en SQLite y Postgres

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). LangGraph.js publica checkpointers para Postgres, SQLite, Mongo y Redis; nosotros tenemos journals en memoria, archivo, ndjson y Redis.
**Depende de:** [SPEC-0023](SPEC-0023-flujos-declarativos.md) (contrato `RunJournal`), [SPEC-0024](SPEC-0024-journal-de-corridas-ndjson.md).
**Tipo de cambio:** aditivo, en un paquete nuevo. Core no cambia.
**Objetivo:** que un equipo con Postgres (la base que ya tiene) o con SQLite (un solo nodo, sin servicios) pueda guardar las corridas de sus flows sin montar Redis ni depender de archivos en disco.

## 1. De dónde se parte

Verificado el 2026-11-17:

- El contrato es `RunJournal` (`packages/core/src/flow/journal.ts`): `begin`, `step`, `update`, `claim`, `get`, `list`. El estado de una corrida es la **reducción de un registro de eventos** (`foldEvents`); el filtro de `list` es `journalMatches`. Ambos se exportan desde `agent-core`.
- `RedisRunJournal` (`packages/flow-queue/src/redis-journal.ts`) es el modelo a seguir: una lista de eventos por corrida, un `claim` con expiración y un conjunto de ids para `list`, cada mutación atómica (scripts Lua). Vive en `agent-flow-queue` porque necesita `ioredis`.
- `NdjsonRunJournal` y `FileRunJournal` son de un solo nodo y dependen del disco.
- Cada journal tiene su propio archivo de pruebas (`journal.test.ts`, `ndjson-journal.test.ts`, la de Redis en `flow-queue`); **no hay una batería común** que cualquier implementación deba pasar.
- `core` declara Node `>=20`.

## 2. Evidencia en la competencia

LangGraph.js, commit `7257a24`: `libs/checkpoint-postgres`, `libs/checkpoint-sqlite`, `libs/checkpoint-mongodb`, `libs/checkpoint-redis` y `libs/checkpoint-validation`, una batería de validación que cualquier checkpointer debe pasar. Ese último es el patrón que falta aquí.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Dónde vive? | **Un paquete nuevo, `@backendkit-labs/agent-flow-sql`**, con `SqliteRunJournal` y `PostgresRunJournal`. Core no gana dependencias. |
| D2 | ¿Qué driver? | **Ninguno propio: se inyecta un cliente mínimo** (`SqlClient`: `query(sql, params)` y una transacción). Lo implementan `pg` (Pool) y `better-sqlite3` con un adaptador de pocas líneas, incluido. Así el paquete no impone versiones. `node:sqlite` no vale como base porque core soporta Node 20. |
| D3 | ¿Qué esquema? | **Una tabla de eventos** `run_events(run_id, seq, at, kind, payload)` con clave `(run_id, seq)` más un índice `runs(run_id, flow, tenant_id, status, updated_at)` mantenido en la **misma transacción**. El estado sale de `foldEvents`, igual que Redis y ndjson. |
| D4 | ¿Cómo se toma el `claim`? | Una tabla `run_claims(run_id, owner, expires_at)` y un `INSERT ... ON CONFLICT DO UPDATE ... WHERE expires_at < now() OR owner = $owner`. Libera borrando solo si el dueño coincide. |
| D5 | ¿Qué pasa con una escritura de quien ya no es dueño? | **Vallado por `seq`:** un evento se inserta con el `seq` esperado; un conflicto de clave primaria es `JournalConflict`, como pide SPEC-0024 F3 para Redis. |
| D6 | ¿Cómo se prueba sin una base en CI? | **Batería común** (`journalConformance(factory)`) extraída de las pruebas actuales; SQLite corre siempre; Postgres solo con `TEST_POSTGRES_URL`, para no depender de un servicio en CI. |

## 4. Diseño

```ts
import { SqliteRunJournal, PostgresRunJournal } from '@backendkit-labs/agent-flow-sql';

const journal = new PostgresRunJournal({ client: pgAdapter(pool), schema: 'flows' });
await journal.migrate();            // crea las tablas si no existen; idempotente

await runFlow(def, { journal, runId, executor });
```

- Los nombres de tabla llevan un prefijo configurable.
- `migrate()` es explícito: el journal no crea tablas por su cuenta en producción.
- El payload y las salidas se guardan como los demás journals; `redact` se aplica antes de escribir.

## 5. Fases

- **F0. Verificar y extraer la batería común.** Comprobar la lista de pruebas de `journal.test.ts` y `ndjson-journal.test.ts`; crear `journalConformance(factory)` en `agent-testkit` o en core y hacer que los tres journals existentes la pasen. Esto no cambia comportamiento y es la base de todo lo demás.
- **F1. `SqliteRunJournal`** con adaptador de `better-sqlite3`. Prueba: pasa la batería; dos instancias sobre el mismo archivo se disputan un `claim` y solo una gana.
- **F2. `PostgresRunJournal`.** Prueba (con `TEST_POSTGRES_URL`): pasa la batería; el vallado por `seq` rechaza al dueño caducado; `list` filtra por estado, flow y tenant.
- **F3. Guía** en la web ("elegir un journal": memoria, archivo, ndjson, Redis, SQL, con el criterio de cada uno).

## 6. Criterios de aceptación

- Cualquier journal del repo pasa la misma batería; añadir uno nuevo es implementar el contrato y ejecutarla.
- Una corrida iniciada con un journal se reanuda en otro proceso que comparta la base, sin repetir pasos hechos.

## 7. Riesgos y fuera de alcance

- El `fsync` y la cadena de integridad de SPEC-0024 no se replican: la base garantiza la durabilidad; la cadena queda como propiedad de ndjson.
- Fuera de alcance: migraciones entre journals y retención automática (se documenta que borrar corridas viejas es del integrador, como en Redis).
