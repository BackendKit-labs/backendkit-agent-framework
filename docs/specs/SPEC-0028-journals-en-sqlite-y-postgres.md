# SPEC-0028: `RunJournal` en SQLite y Postgres

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta. **F0 hecha (2026-11-17)**: batería común en core (`agent-core/testing`), ver §8. **F1 hecha (2026-11-17)**: `SqliteRunJournal`, ver §9. F2 y F3 sin implementar.
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

- **F0. Verificar y extraer la batería común. HECHA, ver §8.** Comprobar la lista de pruebas de `journal.test.ts` y `ndjson-journal.test.ts`; crear `journalConformance(factory)` en `agent-testkit` o en core y hacer que los tres journals existentes la pasen. Esto no cambia comportamiento y es la base de todo lo demás.
- **F1. `SqliteRunJournal`. HECHA, ver §9.** Con un adaptador estructural que sirve a `node:sqlite` y a `better-sqlite3`. Prueba: pasa la batería; dos instancias sobre el mismo archivo se disputan un `claim` y solo una gana.
- **F2. `PostgresRunJournal`.** Prueba (con `TEST_POSTGRES_URL`): pasa la batería; el vallado por `seq` rechaza al dueño caducado; `list` filtra por estado, flow y tenant.
- **F3. Guía** en la web ("elegir un journal": memoria, archivo, ndjson, Redis, SQL, con el criterio de cada uno).

## 6. Criterios de aceptación

- Cualquier journal del repo pasa la misma batería; añadir uno nuevo es implementar el contrato y ejecutarla.
- Una corrida iniciada con un journal se reanuda en otro proceso que comparta la base, sin repetir pasos hechos.

## 7. Riesgos y fuera de alcance

- El `fsync` y la cadena de integridad de SPEC-0024 no se replican: la base garantiza la durabilidad; la cadena queda como propiedad de ndjson.
- Fuera de alcance: migraciones entre journals y retención automática (se documenta que borrar corridas viejas es del integrador, como en Redis).

## 8. Resultado de F0 (2026-11-17)

**Qué se hizo.** La batería de contrato `journalConformance` (y `journalConformanceCases`, para otros ejecutores de pruebas) vive en **core**, en la subruta `@backendkit-labs/agent-core/testing` (`packages/core/src/testing/journalConformance.ts`): quien implementa un `RunJournal` ya depende de core, y las pruebas de core la ejecutan sin ciclos (`packages/core/src/flow/__tests__/journal-conformance.test.ts`). Se probó antes en `agent-testkit` y se movió: el testkit tiene a core como peer, y un lugar que core no puede importar obligaba a ejecutar los journals de core desde otro paquete. Como los paquetes resuelven con `moduleResolution: node` y no entienden las subrutas de `exports`, core declara `typesVersions` para `testing`. Las pruebas del journal de Redis, en `agent-flow-queue`, la importan de ahí. El futuro `agent-flow-sql` hará lo mismo.

**La batería (13 casos de contrato y hasta 5 condicionados a una capacidad: el TTL, tres de almacenamiento compartido y los ids):** `get` de una corrida inexistente; `begin` crea una corrida `running` con flow, vista previa y tenant; `begin` de un id existente falla sin cambiar la corrida; `step` y `update` sobre una corrida inexistente fallan y no crean nada; los parches de `step` se funden; las transiciones se acumulan en orden; `update` fija el estado y solo uno terminal fija `finishedAt`; `waiting` se fija y se limpia con `null`; `list` filtra por estado, flow y tenant y **devuelve las corridas de la más antigua a la más reciente**; escritores simultáneos no pierden eventos; el `claim` es exclusivo, el mismo dueño puede renovarlo y `release` lo libera; un `release` obsoleto no libera un claim nuevo; un claim sin renovar caduca por TTL; una corrida escrita por un objeto la lee otro sobre el mismo almacenamiento; varios objetos se disputan un claim y gana uno solo; y varios objetos que escriben a la vez no pierden ninguna escritura confirmada. Con `rejectsUnsafeIds`, un id como `../escape` se rechaza.

**Resultado.** `MemoryRunJournal`, `FileRunJournal`, `NdjsonRunJournal` y `RedisRunJournal` (con el Redis simulado de su prueba **y con Redis real 7**, que ejecuta los scripts Lua) la pasan. Core, testkit y flow-queue no cambian de comportamiento: no se tocó ningún journal.

**Divergencias que salieron, y cómo quedan como capacidades declaradas** (en lugar de relajar la batería):

| Divergencia | Opción | Quién |
|---|---|---|
| El claim de ndjson ignora el TTL y se libera cuando su dueño desaparece (SPEC-0024 D2) | `expiresByTtl: false` | `NdjsonRunJournal` |
| Un segundo objeto que escribe en una corrida que otro ya escribió recibe `JournalConflict` en lugar de añadir (un escritor por corrida) | `exclusiveWriter: true`. Aun así, **una escritura confirmada nunca se pierde** y toda negativa es `JournalConflict` | `NdjsonRunJournal`; **es la semántica que D5 propone para SQL** |
| Memory no valida los ids; File, ndjson y Redis rechazan los que no son seguros | `rejectsUnsafeIds: true` | File, ndjson, Redis |

**Hallazgos para F1 y F2.**
1. El orden de `list` (más antigua primero, por `startedAt`) era un hecho de los cuatro journals que no estaba escrito en ninguna parte. Ahora es parte del contrato y de la batería: un journal SQL debe `ORDER BY started_at`.
2. `exclusiveWriter` nombra la decisión de D5. Si los journals SQL la adoptan, la batería ya la comprueba; si prefieren permitir escritores concurrentes como Redis, también.
3. Las pruebas de `journal.test.ts` en core (que ejecutan `runFlow` sobre cada journal) **se quedan**: prueban el comportamiento del motor, no el contrato del journal. La batería no las sustituye.
4. Para ejecutar la batería contra Redis real hace falta un Redis accesible (`REDIS_HOST` y `REDIS_PORT`); sin él se omiten esos casos, como ya hacía la prueba de integración existente. En esta sesión se usó un contenedor temporal.
5. **D6 se cumple tal cual:** la batería queda en core. Sale con el próximo release de `agent-core`, y `agent-flow-sql` la usará de ahí. `agent-testkit` no cambia.

**Pendiente de F0.** El CHANGELOG no se toca hasta el release que incluya el testkit nuevo.

## 9. Resultado de F1 (2026-11-17)

**Qué se hizo.** Paquete nuevo `@backendkit-labs/agent-flow-sql` 0.1.0 (`packages/flow-sql`), sin publicar, con paso de build en el CI y entrada en el lockfile:

- `SqlRunJournal`: el journal, **neutro respecto a la base**. Recibe un `SqlClient` (`query` y `transaction`, con marcadores `?`) y escribe SQL portable: tablas `flow_run_events`, `flow_runs` y `flow_run_claims` con `TEXT` y `BIGINT`, `INSERT ... ON CONFLICT DO NOTHING` y un upsert condicionado para el claim. `migrate()` y `ddl()` son explícitos; el prefijo de tablas se valida (un nombre de tabla no se puede parametrizar).
- `SqliteRunJournal` y `sqliteClient(db)`: un adaptador sobre un handle síncrono con `prepare(sql).all/run` y `exec`, que cumplen `node:sqlite` (`DatabaseSync`) y `better-sqlite3`. Activa `busy_timeout` y WAL.
- **Un escritor por corrida (D5):** el objeto recuerda el último `seq` que escribió; un segundo objeto que escribió entre medias hace que el siguiente `INSERT` choque en `(run_id, seq)`, y eso es `JournalConflict`. Se detecta con `ON CONFLICT DO NOTHING` y `rowCount`, sin interpretar códigos de error de ningún driver. Las escrituras de un mismo objeto a una misma corrida se encadenan para no chocar entre sí.
- **`list`:** un `JOIN` con el índice `flow_runs` (filtros por flow, tenant y estado), ordenado por `started_at`; el índice se actualiza en la misma transacción que el evento que lo cambia.

**Verificación.** 34 pruebas, 100 % de líneas: la batería común de core (con `exclusiveWriter: true` y `rejectsUnsafeIds: true`, cada objeto con su propia conexión), el motor de flujos reanudando tras una caída, `FlowClaimError` entre dos corredores, el cliente (transacciones, reversión, serialización) y **dos pruebas con procesos reales**: de seis procesos que se disputan un claim gana exactamente uno, y cuatro procesos que escriben a la vez en una corrida solo reciben `JournalConflict` (nunca un error de lock) sin perder ninguna escritura confirmada. Las de procesos usan el paquete compilado y se omiten si falta `dist`.

**Hallazgos.**
1. **Una cola de transacciones por proceso, no por cliente.** La primera versión serializaba por cliente y la batería falló con `database is locked`: un driver síncrono **bloquea el hilo** mientras espera el lock de otra conexión, y una transacción suspendida en un `await` retiene su lock sin poder avanzar, así que una segunda conexión **del mismo proceso** espera para siempre. Con una sola cola para todo el proceso las transacciones no se solapan; otro **proceso** no se ve afectado (espera en el lock de SQLite mientras este avanza). Esto cuenta para F2: `pg` es asíncrono y no tiene este problema.
2. **El reloj del `claim` es el del proceso** (`Date.now()`), no el de la base. Con relojes muy desfasados entre procesos la caducidad se desplaza. Postgres permitiría usar `now()`; se decide en F2.
3. **`better-sqlite3` no está probado** aquí: el CI usa Node 24 y se probó con `node:sqlite`. El adaptador es estructural, pero hasta que se pruebe con ese driver la promesa es "debería". En Node 20, `node:sqlite` no existe y las pruebas del paquete se omiten, no fallan.
4. **`list` lee todos los eventos de las corridas que coinciden** y las pliega en memoria, como el resto de journals; no hay paginación. Es aceptable para cientos de corridas; con miles habrá que paginar o guardar el estado resumido en `flow_runs`.
5. Las pruebas importan `@backendkit-labs/agent-core/testing`, que aún no está en un `agent-core` publicado: dentro del monorepo funciona; la batería saldrá con el próximo release.

**Lo que F2 reutiliza sin cambios:** `SqlRunJournal`, el DDL y la batería. Solo hacen falta un `SqlClient` para `pg` (conversión `?` → `$n`, transacción con una conexión dedicada) y sus pruebas, que corren con `TEST_POSTGRES_URL`.
