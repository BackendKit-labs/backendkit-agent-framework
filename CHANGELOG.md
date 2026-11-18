# Changelog

## Sin publicar

- **`agent-core`, un id por corrida (SPEC-0039 F1):** `engine.run(input, { runId? })` da a cada corrida un `runId` (el que pases, por ejemplo el de un flujo, o un UUID). Está en `RunResult.runId`, en cada `AuditEvent.runId` (opcional; entra en la cadena de hashes) y como etiqueta `run_id` en los spans, y el evento `ready` lo lleva. De un evento de auditoría se llega a su corrida y a su traza, y al revés. Un delegado comparte el id del turno. Aditivo: todo es opcional.

## v0.48.1 (2026-11-18)

Patch aditivo: el arnés de evaluación (SPEC-0021) y la opción que le da los argumentos de las llamadas. `^0.47.0` cubre 0.47.1 y `agent-testkit` no tiene dependientes con un rango que se rompa, así que no hay barrido de rangos y solo suben estos dos paquetes. Los graders que leen argumentos necesitan `agent-core` 0.47.1 o más (con una versión anterior `recordArgs` no existe y esos graders fallan diciéndolo).

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.47.1 | `recordArgs` |
| `agent-testkit` | 0.1.18 | `evalSuite`, `compare`, graders, `writeReport` y `readReport` |

- **`agent-core`, `recordArgs`:** `createBaseEngine({ recordArgs: true })` pone los argumentos de cada llamada a una tool en `RunResult.toolCalls[].args` (SPEC-0021 F0). Van solo al resultado: el evento `tool_result` no los lleva, así que ningún transporte los recibe. Apagado por defecto: pueden llevar datos sensibles y la auditoría solo guarda su hash. Aditivo.
- **`agent-testkit`, arnés de evaluación (SPEC-0021 F1 a F4):** `evalSuite`, `compare`, `formatReport`, `formatComparison`, `writeReport` / `readReport` (un informe guardado en un archivo `0o600`, para comparar entre ejecuciones) y graders (`toolCalled`, `toolNotCalled`, `noToolErrors`, `errorCode`, `textMatches`, `withinBudget`, `maxToolCalls`, `grader`). Casos como datos, repeticiones con semilla, informe JSON repetible (`schema: 1`) y comparación de dos configuraciones; con un proveedor guionizado o una grabación corre en CI sin modelo ni coste. La suite se detiene si una corrida supera el presupuesto del engine y lo dice en el informe. Sin probar con un modelo real ni con el banco `trading-bot` (F5). Ver la guía [Test an agent](https://backendkit-agent-framework.vercel.app/guides/test-an-agent/).

## v0.48.0 (2026-11-18)

Se elimina `FileRunJournal` (ruptura de `agent-core`, SPEC-0024 F4). En 0.x, `^0.46` no cubre 0.47, así que se barrieron los rangos de `agent-core` (`^0.47.0`) y los peers anchos pasan a `<0.48.0`. `agent-flow-sql` no sube: su peer (`>=0.46.0 <0.48.0`) ya cubre 0.47. `codemod`, `agent-flow-sql`, `agent-protocol`, `mcp-connectors` y `agent-web-ui` no cambian.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.47.0 | **rompe:** sin `FileRunJournal` (usa `NdjsonRunJournal`) |
| `agent-coding` 0.32.5, `agent-enterprise` 0.11.4, `mcp-server` 0.19.9, `agent-web` 0.6.14, `agent-providers` 0.3.14, `agent-sandbox` 0.1.17, `agent-testkit` 0.1.17, `agent-otel` 0.1.20, `agent-flow-queue` 0.1.4, `document-extract` 0.1.10, `aval-tools` 0.1.24, `create-bk-agent` 0.24.4 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, con ruptura: `FileRunJournal` se elimina** (SPEC-0024 F4). Era el primer journal de archivo (un archivo por evento) y `NdjsonRunJournal` (0.45.0) lo mejora en todo para un host: unas 3 veces más rápido al escribir y 58 veces al leer, con integridad por cadena y relevo inmediato de un dueño muerto. Se quitó en vez de deprecarlo porque el framework está en desarrollo. **Migración:** cambia `new FileRunJournal(dir)` por `new NdjsonRunJournal(dir)`. Las corridas que un `FileRunJournal` dejó en disco **no las lee** `NdjsonRunJournal` (otro formato): una corrida a medias no se reanuda, y una terminada hay que leerla antes de actualizar si interesa. El claim de `NdjsonRunJournal` se libera al morir su dueño (comprobación del pid) y no por TTL, así que **dos contenedores que comparten un volumen no se ven los pids**: ahí usa `RedisRunJournal` o `PostgresRunJournal`. Ver [Migrate between versions](https://backendkit-agent-framework.vercel.app/guides/migrate-between-versions/).

## v0.47.1 (2026-11-18)

Patch: un buscador propio y un modo nuevo para `tool_search`, y la documentación de `agent-flow-sql`. Es aditivo: `^0.46.0` cubre 0.46.1, así que no hay barrido de rangos y solo suben estos dos paquetes.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.46.1 | `toolSearch.search` y `toolSearch.mode` (SPEC-0030 F5 y §11) |
| `agent-flow-sql` | 0.1.1 | solo el README: probado con Postgres 14 a 18; pgbouncer en modo statement no funciona (rechaza las transacciones) |

- **`agent-core`, un buscador propio para `tool_search`:** `createBaseEngine({ toolSearch: { search, maxResults } })`. `search(query, candidates)` (síncrono o asíncrono) recibe solo las tools diferidas que el agente puede llamar y que ni la política ni la sandbox deniegan; lo que devuelva y no sea candidata se descarta, así que no puede saltarse el gobierno. Sin probar con embeddings reales.
- **`agent-core`, `toolSearch.mode: 'message'`:** la lista de tools del modelo no cambia; la respuesta de `tool_search` trae nombre, descripción y parámetros de lo encontrado y el modelo llama a la tool por su nombre. Evita cortar la caché del proveedor en cada búsqueda. Con DeepSeek (40 tools, 9 corridas por variante) costó lo mismo que listar las 40 tools, con un 64 % menos de tokens de entrada y sin fallos; el modo por defecto (`'list'`) costó un 10 % más. No ahorra dinero con pocas tools; sirve con listas grandes o cuando el límite es el contexto. Sin probar con Anthropic ni OpenAI: si un proveedor rechaza la llamada a una tool que no está en su lista, no sirve con él. Ver SPEC-0030 §10 y §11.

## v0.47.0 (2026-11-18)

`tool_search` para tools diferidas, un arreglo real de la renovación del claim, el adaptador del AI SDK y dos paquetes nuevos (`agent-flow-sql`, `codemod`). En 0.x, `^0.45` no cubre 0.46, así que se barrieron los rangos de `agent-core` (`^0.46.0`) y los peers anchos pasan a `<0.47.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.46.0 | `tool_search` y `defer` / `deferTools` (#233); arreglo de la renovación del claim en `runFlow` (#234); `agent-core/testing` con `journalConformance` |
| `agent-providers` | 0.3.13 | `AiSdkProvider` y `fromAiSdk` (#232); el peer de `agent-core` sube a `<0.47.0` |
| `agent-flow-sql` | 0.1.0 | **nuevo:** `RunJournal` sobre SQLite y Postgres; peer `agent-core >=0.46.0 <0.48.0` |
| `@backendkit-labs/codemod` | 0.1.0 | **nuevo:** migraciones automáticas de las rupturas ([SPEC-0037](docs/specs/SPEC-0037-codemods-y-guias-de-migracion.md)) |
| `agent-coding` 0.32.4, `agent-enterprise` 0.11.3, `mcp-server` 0.19.8, `agent-web` 0.6.13, `agent-sandbox` 0.1.16, `agent-testkit` 0.1.16, `agent-otel` 0.1.19, `agent-flow-queue` 0.1.3, `document-extract` 0.1.9, `aval-tools` 0.1.23, `create-bk-agent` 0.24.3 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, `tool_search` (SPEC-0030):** una tool con `defer: true` (o que case con `deferTools` del agente, solo comodines) no se manda al modelo con su esquema; el modelo la descubre con `tool_search` y desde ese momento forma parte de la lista, siempre al final de la lista (aun así cada búsqueda cambia la lista y la caché del proveedor se corta ahí; ver SPEC-0030 §10). El gobierno no se salta: lo que la sandbox o la política deniegan sigue oculto, y encontrar una tool nunca la autoriza.
- **`agent-core`, arreglo de `runFlow` (#234):** una renovación del claim aún en vuelo cuando la corrida terminaba podía llegar después de liberar el claim y volver a tomarlo, dejando la corrida retenida hasta que vencía el TTL; ahora `runFlow` espera la renovación (con tope) antes de liberar. Era la causa de las pruebas intermitentes en Windows.
- **`agent-core/testing`:** `journalConformance`, la batería que cualquier `RunJournal` debe pasar (la usa `agent-flow-sql`).
- **`agent-providers`, `AiSdkProvider` / `fromAiSdk` (SPEC-0029):** cualquier modelo del AI SDK (interfaces v2, v3 y v4) como proveedor del framework. Probado en vivo con DeepSeek; sin probar con Anthropic ni Gemini, y los bloques de razonamiento opacos (`raw`) no se transportan.
- **`agent-flow-sql`, nuevo:** `RunJournal` sobre SQLite y Postgres: las corridas sobreviven al proceso y cualquier proceso que comparta la base puede reanudarlas. Probado con Postgres 14 a 18 y pgbouncer en modo transaction; en modo statement no funciona (rechaza las transacciones, con un error claro). Sin probar con Neon.
- **`codemod`, nuevo:** `npx @backendkit-labs/codemod <nombre> ./src` con `scope-rename`, `coding-split`, `terminal-app-split` y `zod4-record`; `--list` y `--dry-run`. Probado contra la migración manual de `mcp-server` y sobre `aiops-agent`; `coding-split` solo con fixtures. Guía: [Migrate between versions](https://backendkit-agent-framework.vercel.app/guides/migrate-between-versions/).

## v0.46.0 (2026-11-17)

El banco de pruebas `audit-desk` (una auditoría exhaustiva con Redis real, procesos reales y un kill duro) destapó dos fallos del motor de flujos y permitió probar por primera vez los scripts Lua de Redis; de ahí sale además un journal nuevo para un host ([SPEC-0024](docs/specs/SPEC-0024-journal-de-corridas-ndjson.md), el diseño del journal de Steward llevado al SDK). En 0.x, `^0.44` no cubre 0.45, así que se barrieron los rangos de `agent-core` (`^0.45.0`) y los peers anchos pasan a `<0.46.0`. Solo suben los paquetes afectados; `web-ui` cambió solo su README y no sube; `mcp-connectors`, `agent-protocol` y `agent-web-ui` no cambian.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.45.0 | `NdjsonRunJournal` (+ `JournalCorrupt`, `JournalConflict`), vallado en `runFlow`, `FileRunJournal` sin contención, `flow_wait`, flujos con puerta humana en `FlowHost` |
| `agent-flow-queue` | 0.1.2 | un paso instantáneo ya no espera hasta el plazo por un aviso perdido (`pollMs`); el peer de `agent-core` sube a `>=0.43.0 <0.46.0` (el `>=0.42.0` de 0.1.1 era erróneo: usa `foldEvents`, que existe desde 0.43.0) |
| `agent-coding` 0.32.3, `agent-enterprise` 0.11.2, `mcp-server` 0.19.7, `agent-web` 0.6.12, `agent-providers` 0.3.12, `agent-sandbox` 0.1.15, `agent-testkit` 0.1.15, `agent-otel` 0.1.18, `document-extract` 0.1.8, `aval-tools` 0.1.22, `create-bk-agent` 0.24.2 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, `NdjsonRunJournal` (SPEC-0024 F1 y F2):** un journal de corridas para **un host**, con un archivo `<runId>.ndjson` por corrida. Cadena de integridad entre líneas (HMAC con `key`, o SHA-256 sin ella: quitar, cambiar, añadir o reordenar una línea da `JournalCorrupt`, y `list` la aparta sin esconder las demás), `fsync` por evento, línea cortada ignorada y recortada antes de la siguiente escritura, archivos `0o600`. Un escritor por corrida, con **vallado**: si otro escribe en el archivo, este escritor recibe `JournalConflict`. El claim es un archivo de bloqueo con el pid del proceso: un dueño **muerto** se releva al instante (con Redis había que esperar el TTL; medido: 10-18 ms tras un SIGKILL), uno vivo se respeta por mucho que tarde, y el TTL se ignora. Medido en Windows: escribe 3,0 frente a 9,1 ms/evento y lee 400 eventos en 9,5 frente a 555 ms respecto a `FileRunJournal`. Asume un host (para varias máquinas, `RedisRunJournal`); quitar las **últimas** líneas deja una cadena válida (haría falta un ancla fuera del archivo).
- **`agent-core`, vallado en `runFlow`:** un `JournalConflict` en cualquier escritura se trata como el claim perdido: la corrida se detiene, no escribe más y `runFlow` lanza `FlowClaimError`. Cierra un hueco real: tras perder el claim, un paso en vuelo que terminaba todavía escribía en el journal.
- **`agent-core`, `FileRunJournal` ya no falla con un fan-out ancho:** con más de ~20 pasos terminando a la vez los `append` competían por el mismo número de evento y agotaban sus 20 reintentos (`too much contention`, incluso en un solo proceso); como el journal falla cerrado, la corrida acababa `failed`. Los `append` de una corrida se serializan ahora en el proceso y la competencia entre procesos reintenta con jitter con `@backendkit-labs/retry`.
- **`agent-flow-queue`, un paso instantáneo no vuelve a esperar hasta el plazo por un aviso perdido:** BullMQ anuncia el fin de un job por un flujo de eventos (`XREAD ... $`), y un aviso emitido antes de que un `QueueEvents` recién creado empiece a leer no se entrega nunca. Un paso que termina en milisegundos en una cola usada por primera vez (el paso `report` de `audit-desk`, en 2 de cada 3 reanudaciones tras matar el orquestador) esperaba hasta `timeoutMs` y fallaba aunque el worker lo hubiera completado. `QueueStepExecutor` mira ahora el propio job cada `pollMs` (por defecto 1000; 0 lo apaga). Los tests con mocks no podían verlo.
- **`agent-core`, `flow_wait` en `createFlowTools`:** espera a que una corrida deje de estar `running` (done, failed, cancelled, paused, awaiting_approval) o venza el plazo (por defecto 30 s, máximo 60 s) y devuelve su estado con `timedOut`. Sin ella, un agente que supervisa flujos sondeaba con `flow_status`, un turno de modelo por consulta. Es `readOnly` (varias esperas de un mismo turno corren en paralelo), respeta la señal del turno y admite `waitPollMs`.
- **`agent-core`, un flujo con puerta humana alojado en `FlowHost` ya no acaba `failed`:** con `flowFromDefinition`, un paso con `gate.approval: human` dejaba la corrida en `failed` ("flow awaiting_approval"), y el `flowRunId` del host no era el `runId` de `runFlow`, así que un supervisor no podía saber el id de la aprobación. Ahora `FlowControl` trae `runId` y `flowFromDefinition` lo usa para el journal y las aprobaciones (la aprobación de un paso es `stepApprovalId(flowRunId, stepId)`); la corrida queda `awaiting_approval` (`FlowAwaitingApproval`, exportada), `resume` la continúa desde el journal una vez decidida y `cancel` funciona mientras espera. Quien implemente `FlowControl` a mano debe añadir `runId`. Hallado al construir el agente `captain` de `release-captain`.
- **Verificado contra Redis real por primera vez:** los scripts Lua de `RedisRunJournal` (40 `begin`, 300 appends y 30 `claim` simultáneos; renovación; expiración) y la cola con workers en otros procesos pasan contra un Redis 7.4 en contenedor.
- **Tests:** tres tests de la renovación del claim (v0.45.0) dependían de TTLs de 60-90 ms y fallaban bajo la carga de la suite completa: ahora con holgura.

## v0.45.0 (2026-11-17)

Tres arreglos del motor de flujos que halló el banco de pruebas del research desk, y los docs de v0.44.0 en los paquetes. En 0.x, `^0.43` no cubre 0.44, así que se barrieron los rangos de `agent-core` (`^0.44.0`) y los peers anchos pasan a `<0.45.0`. Solo suben los paquetes afectados; `mcp-connectors` y `agent-web-ui` no cambian (su rango ya cubre las versiones nuevas).

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.44.0 | claim renovado mientras el run vive, `when` en los pasos, `FlowResult.costUsd` |
| `agent-protocol` 0.7.1, `agent-flow-queue` 0.1.1 | patch | solo el README (aprobaciones 1.2; cola BullMQ y journal Redis con ejemplos) |
| `agent-coding` 0.32.2, `agent-enterprise` 0.11.1, `mcp-server` 0.19.6, `agent-web` 0.6.11, `agent-providers` 0.3.11, `agent-sandbox` 0.1.14, `agent-testkit` 0.1.14, `agent-otel` 0.1.17, `document-extract` 0.1.7, `aval-tools` 0.1.21, `create-bk-agent` 0.24.1 | patch | solo el rango de `agent-core` (y los templates) |

Tres arreglos del motor de flujos que halló el banco de pruebas del research desk (`agent-framework-examples/trading-bot`, hallazgos 6, 7 y 9):

- **`agent-core`, el claim de un run se renueva mientras el run vive:** antes `claimTtlMs` (10 min por defecto) era la vida del claim desde que se tomaba, y un run más largo podía ser tomado por otro proceso **mientras el primero seguía corriendo** (un paso con efecto externo habría corrido dos veces). Ahora `runFlow` lo renueva cada `claimRenewMs` (por defecto un tercio del TTL) y el claim solo expira cuando el proceso se detiene. Si una renovación encuentra el claim en manos de otro, el run se detiene, no escribe sobre el nuevo dueño y `runFlow` lanza `FlowClaimError`. `claimRenewMs: 0` apaga la renovación (para simular un proceso caído). **Comportamiento nuevo:** un run con journal mantiene un temporizador (sin `ref`) mientras corre.
- **`agent-core`, pasos condicionales:** `when: { step, contains | equals | matches, not? }` en un paso. Si la condición no se cumple, o no se puede evaluar porque el paso que mira no produjo salida, el paso queda `skipped` antes de cualquier otra cosa: no corre, no se pide aprobación, los pasos que lo esperan se saltan y el flujo **no** falla. `validateFlow` exige que `when.step` esté en `after` y que `matches` sea una expresión válida. Nuevo tipo `FlowCondition`.
- **`agent-core`, el resultado trae el coste:** `FlowResult.costUsd` suma los `costUsd` de los pasos (ausente si ninguno lo reportó); también al responder un run terminado desde el journal.

## v0.44.0 (2026-11-17)

Motor de flujos ([SPEC-0023](docs/specs/SPEC-0023-flujos-declarativos.md)), protocolo 1.2 y ciclo de vida de la lección ([SPEC-0022](docs/specs/SPEC-0022-ciclo-de-vida-de-la-leccion.md)). `orchestrator-agent` se retira del framework (se absorbe en las librerías; la app vive en `bk-platform`). En 0.x, `^0.42` no cubre 0.43 y `^0.10` no cubre 0.11, así que se barrieron los rangos: `agent-core` `^0.43.0`, `agent-enterprise` `^0.11.0`, `agent-protocol` `^0.7.0`, y los peers anchos pasan a `<0.44.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.7.0 | protocolo 1.2: `ApprovalHandler`, estados `awaiting_approval` y `lost`, `CONFLICT` |
| `agent-core` | 0.43.0 | `FlowDefinition` y loader, `runFlow` (oleadas, topes, `StepExecutor`, `onStepFailure`, `timeoutMs`), `RunJournal` (memoria y archivos, reanudar), aprobación por paso, `planFlow`, `createApprovalHandler` y `createFlowTools`, `foldEvents`/`journalMatches`; ciclo de vida de la lección |
| `agent-enterprise` | 0.11.0 | `FlowLoader` re-exporta el de core |
| `agent-flow-queue` | 0.1.0 (nuevo) | `QueueStepExecutor` / `createStepWorker` sobre BullMQ y `RedisRunJournal` (Lua sin probar contra Redis real) |
| `create-bk-agent` | 0.24.0 | quita la arquitectura `orchestrator` y su plantilla |
| `agent-coding` 0.32.1, `mcp-server` 0.19.5, `mcp-connectors` 0.2.5, `agent-web` 0.6.10, `agent-providers` 0.3.10, `agent-sandbox` 0.1.13, `agent-testkit` 0.1.13, `agent-otel` 0.1.16, `document-extract` 0.1.6, `aval-tools` 0.1.20 | patch | solo el rango de `agent-core` / `agent-enterprise` |

**Retirado:** `@backendkit-labs/orchestrator-agent` ya no está en el repo (última publicada 0.7.7). Sus piezas: planner → `planFlow`, ejecución → `runFlow`, run store → `RunJournal`, cola → `agent-flow-queue`, aprobaciones → `createApprovalHandler`. El servidor MCP/HTTP no se reconstruye.

### Ciclo de vida de la lección (SPEC-0022)

[SPEC-0022](docs/specs/SPEC-0022-ciclo-de-vida-de-la-leccion.md) F1-F4: el ciclo de vida de la lección. **Cambia el comportamiento de 0.42.0** (el aprendizaje ya publicado): una lección aprendida ya no caduca con la ventana si su sujeto se sigue llamando.

- **`agent-core`, la lección se queda mientras su sujeto se siga llamando:** el banco de pruebas mostró que una lección que funciona perdía sus fallos en la ventana, caducaba y el error volvía (19 rechazos en 245 sesiones). Ahora sale cuando el sujeto no tiene llamadas ni fallos durante `quietAfterDays` (por defecto, la ventana) o cuando una persona la resuelve. Un patrón sin sujeto (una señal de un vertical) sigue saliendo con su ventana. **Consecuencia:** un fallo pasajero (una caída de tres timeouts) deja su lección mientras la tool se llame, hasta que alguien la resuelva.
- **`agent-core`, registro de patrones:** `learning.records()` (estado, línea, fechas) y `learning.resolve(patternKey, by, { tenantId?, reason? })`, solo para quien permita `approverKinds`. Un patrón resuelto que vuelve a fallar queda activo y su registro lo dice (`reappeared`).
- **`agent-core`, el texto de una lección ya no cambia al reiniciar:** la línea se escribe una vez en el registro del patrón (antes vivía solo en memoria y se reescribía desde el último fallo). Una pista que el autor de una tool mejora después llega a los patrones nuevos, no a los ya escritos.
- **`agent-core`, la propuesta de regla muestra la evidencia:** `3 x tool_error on place_order (3 of 10 calls, 30%), primera a última`, y si el patrón había sido resuelto, que volvió.
- **`agent-core`, los patrones que fallan ahora van antes** que las lecciones que se quedan solo porque su sujeto se sigue llamando, para que estas no ocupen el sitio de un problema nuevo.
- **Migración:** los `counters.json` de 0.42.0 guardan los patrones como `qualified`; se siguen leyendo hasta que el patrón se confirme y se reemplacen por un registro completo. Los contadores se conservan `2 x max(ventana, quietAfterDays)` días.

## v0.43.0 (2026-11-16)

Aprendizaje, segunda iteración ([SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F1 y F2) y las piezas del framework que un bot de trading de papel tuvo que escribir a mano. En 0.x, `^0.41` no cubre 0.42 y `^0.9` no cubre 0.10, así que se barrieron los rangos de los paquetes y templates que los usan: `agent-core` `^0.42.0`, `agent-coding` `^0.32.0`, `agent-enterprise` `^0.10.0`. Los peers con rango ancho (`<0.43.0`) ya cubrían 0.42.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.42.0 | aprendizaje con señal (éxitos contados, ventana, tasa) y lecciones por tool; `engine.run()` devuelve `RunResult`; `ToolError`; `learnedRules` |
| `agent-coding` | 0.32.0 | guarda el aprendizaje con `createLearning({ dir })` y los contadores en `counters.json` |
| `agent-enterprise` | 0.10.0 | igual que coding, con su almacén de reglas |
| `create-bk-agent` 0.23.10, `mcp-server` 0.19.4, `mcp-connectors` 0.2.4, `agent-web` 0.6.9, `agent-providers` 0.3.9, `agent-sandbox` 0.1.12, `agent-testkit` 0.1.12, `agent-otel` 0.1.15, `orchestrator-agent` 0.7.7, `document-extract` 0.1.5, `aval-tools` 0.1.19 | patch | solo el rango de `agent-core`, `agent-coding` o `agent-enterprise` (y los templates) |

Los demás paquetes no cambian: `agent-protocol` y `agent-web-ui`.

### Qué cambia al actualizar

- **`engine.run()` devuelve `RunResult`** en lugar de `void`. Quien hacía `await engine.run(x)` y no usaba el valor no nota nada; un tipo que espere `Promise<void>` hay que ajustarlo.
- **Argumentos mal formados:** `defineTool` lanza `ToolArgumentError` (código `INVALID_ARGUMENTS`) en lugar de devolver el texto como resultado. Cuenta como fallo de la tool en la auditoría y en el aprendizaje.
- **Con aprendizaje activado, cambia el system prompt:** las lecciones se agrupan por tool (`### post_invoice`), y un patrón necesita una tasa de fallo del 5 % desde 20 llamadas dentro de 30 días (antes bastaban 3 fallos). `rate: false` quita la tasa.
- Todo lo demás es aditivo.

### Detalle

Piezas que un bot de trading de papel (`agent-framework-examples/trading-bot`) tuvo que escribir a mano y que son de cualquier agente. Aditivas, salvo el tipo de retorno de `run`.

- **`agent-core`, `engine.run()` devuelve el resultado del turno** (`RunResult`): `text` (lo dicho tras la última tool), `toolCalls` (con `errorCode`, delegados incluidos), `errors`, `aborted`, `budgetExceeded` y `systemPrompts`. Antes devolvía `void`. Un único colector cubre todas las salidas del turno. El evento `tool_result` lleva `error_code` y el de `ask_agent`, `agent_id`.
- **`agent-core`, `emitSystemPrompt` (apagado por defecto):** evento `system_prompt` con el prompt de cada llamada al modelo. Apagado porque un system prompt puede llevar secretos y va a todos los transports.
- **`agent-core`, `engine.budgetExceeded`:** estado del presupuesto de coste, con o sin `abortOnBudget` (el evento `budget_exceeded` sigue atado a `abortOnBudget`).
- **`agent-core`, `ToolError(code, message)`:** error con código estable que el engine pone en la auditoría. `ToolArgumentError` lo extiende.
- **`agent-core`, `createLearning({ dir })`:** todo bajo un directorio con los nombres que coding ya usaba (`experiences.json`, `counters.json`, `proposals/`, `rules.json`, `lessons.json`); un almacén explícito sustituye a su archivo. `createCodingLearning` y `EnterpriseLearning` lo usan, sin mover ningún archivo.
- **`agent-core`, `learning.trackOutcome`:** atajo de `record` (`ok`, `subject`, `context`...). Un éxito sin `subject` se rechaza en vez de perderse.
- **`agent-core`, `Experience.context`:** el mismo `subject` juzgado aparte según las circunstancias; la proporción se mide dentro del contexto. Sin contexto, claves, ids de propuesta, texto de lección y contadores antiguos son idénticos.
- **`agent-core`, `stamp: 'clock'`:** las experiencias del sink, `record` y los contadores toman la hora de `now`, para simulaciones y backtests. Por defecto, la del evento.
- **`agent-core`, las tools leen las reglas aprobadas:** `learnedRules(ctx, guard)` y `LEARNED_RULES_SERVICE`. `createBaseEngine({ learning })` da a las tools una **vista de solo lectura** de las reglas del tenant del engine, nunca el objeto `Learning`: con él una tool podría aprobar haciéndose pasar por una persona. Se mezcla con `services` sea objeto o función.

Arreglos encontrados al probar F1 y F2 con un bot de trading de papel (`agent-framework-examples/trading-bot`, con su `FINDINGS.md`).

- **`agent-core`, una lección que funciona ya no se borra sola:** la proporción de fallos (`rate`) decide cuándo *entra* un patrón; una vez dentro, se queda mientras sus fallos estén en la ventana. Antes, al obedecer la lección, las llamadas correctas diluían la proporción, el patrón y su lección salían y el error volvía (27 rechazos en 19 operaciones). Un patrón sale cuando sus fallos salen de la ventana y tiene que volver a pasar la proporción para reentrar. El patrón calificado se guarda en el almacén de contadores.
- **`agent-core`, los argumentos mal formados son un error con código:** `defineTool` lanza ahora `ToolArgumentError` (código `INVALID_ARGUMENTS`) en lugar de devolver el texto como resultado. El modelo ve el mismo `Error: Invalid arguments ...`, pero la auditoría ya no lo cuenta como éxito y el aprendizaje puede aprender de ello, con una frase del engine (`ENGINE_ERROR_CODES`) que el autor de la tool puede sustituir con `errorHints`. **Cambia el comportamiento** de quien llame a `execute` de una tool de `defineTool` directamente: ahora rechaza en vez de devolver una cadena.
- **`agent-core`, la línea de una lección dice el consejo, no el último símbolo:** con `detail`, la línea es `tipo keeps happening: detail`; sin él, la situación. Antes llevaba la situación de la última experiencia (p. ej. `BBB-SIM`) aunque el patrón abarcara varios símbolos, y el modelo la tomaba como específica de ese símbolo.
- **Documentación:** `Experience.subject` y `rate` explican que la proporción es la del sujeto y que el contexto va en el sujeto.

[SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F1 (la señal del aprendizaje).

- **`agent-core`:** los éxitos se cuentan en vez de guardarse (contadores por día, agente y sujeto), los patrones solo miran los fallos de la ventana (`window`, 30 días por defecto) y una tool con muchas llamadas necesita que los fallos sean una proporción de ellas (`rate`, 5 % desde 20 llamadas por defecto; `rate: false` cuenta solo fallos). `AuditEvent.errorCode` lleva el código del error (`code` o nombre de la clase, nunca el mensaje) y es parte de la clave del patrón: fallos de la misma tool con causas distintas son patrones distintos. **Cambia el comportamiento por defecto:** un fallo de hace más de 30 días ya no cuenta y tres fallos entre mil llamadas ya no forman patrón.
- **`agent-coding` y `agent-enterprise`:** guardan los contadores en un archivo (`counters.json`).

[SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F2 (lecciones que enseñan).

- **`agent-core`, cambia el texto del prompt:** las lecciones se agrupan en unidades, una por tool (`### post_invoice`) y `general` primero; dentro de cada una, lo que enseñó una persona va antes de lo aprendido. La sección pasa a llamarse `## Lessons` (antes `## Taught lessons` y `## Lessons learned`). `lessons.maxPerUnit` (3 por defecto) acota lo aprendido por unidad, y el tope de `maxChars` quita entradas enteras desde el final en vez de cortar una por la mitad.
- **`agent-core`, el consejo lo pone quien conoce el dominio:** `ToolDefinition.errorHints` (y `defineTool({ errorHints })`) dice qué hacer por código de error (`*` para cualquiera). `createBaseEngine` los registra al recibir `learning`. Solo vale para los errores que lanza la tool: para los que el engine ve solo (denegación, bloqueo, timeout, resultado demasiado grande...) hay una frase fija (`ENGINE_HINTS`), así que una pista `*` nunca dice que se repita una llamada rechazada. Los topes (`maxPerUnit`, `maxLessons`) conservan las lecciones más frecuentes, y lo que enseñó una persona se recorta después de lo aprendido.
- **`agent-core`, unidades revisables en git:** `learning.exportUnit`, `learning.importUnit` (el archivo entra entero o no entra, es idempotente y conserva el orden y el primer autor; `replace` olvida lo que salió del archivo; `{ tenantId }` fija el tenant en vez del del front matter) y `learning.units()`. `teach` acepta `unit` e `id`. `EnterpriseLearning` las ofrece sobre su tenant.

## v0.42.0 (2026-11-15)

En 0.x, `^0.40` no cubre 0.41 y `^0.8` no cubre 0.9, así que se barrieron los rangos de todos los paquetes y templates: `agent-core` `^0.41.0`, `agent-coding` `^0.31.0`, `agent-enterprise` `^0.9.0`, y en los peers `<0.43.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.41.0 | módulo `createLearning`, opción `learning`, `teach`, `addRule`, tenants; obsoletos `ReflectionEngine`, `ProceduralMemory` y compañía |
| `agent-coding` | 0.31.0 | **cambia el comportamiento:** con `orchestration`, las reglas aprendidas esperan aprobación y `reflection` ya no está activo por defecto |
| `agent-enterprise` | 0.9.0 | `EnterpriseLearning` y `VaultRuleStore`; `EnterpriseReflection` obsoleto |
| `create-bk-agent` 0.23.9, `mcp-server` 0.19.3, `mcp-connectors` 0.2.3, `agent-web` 0.6.8, `agent-providers` 0.3.8, `agent-sandbox` 0.1.11, `agent-testkit` 0.1.11, `agent-otel` 0.1.14, `orchestrator-agent` 0.7.6, `document-extract` 0.1.4, `aval-tools` 0.1.18 | patch | solo el rango de `agent-core`, `agent-coding` o `agent-enterprise` |

Los demás paquetes no cambian: `agent-protocol` y `agent-web-ui`.

### Migración

- **`agent-coding` con `orchestration`:** si dependías de que las reglas aprendidas se aplicaran solas desde `manifest.yaml`, ahora quedan pendientes en `~/.{appName}/projects/<proyecto>/learning/`. Se aprueban con `createCodingLearning({ appName, projectRoot }).approve(id, { kind: 'human', id })`. El `manifest.yaml` anterior se sigue leyendo. `reflection: true` reactiva el motor anterior.
- **Nada más se retira:** `ReflectionEngine`, `DomainRegistry`, `FailureCatalog`, `PatternDetector`, `PolicyPromoter`, `ProceduralMemory` y `EnterpriseReflection` siguen funcionando, solo marcados `@deprecated`.

[SPEC-0017](docs/specs/SPEC-0017-un-contrato-por-concepto.md) F6 (autoaprendizaje). Aditivo en `agent-core` y `agent-enterprise`; **cambia el comportamiento** de `agent-coding` con `orchestration`.

- **`agent-core`:** módulo `createLearning` con experiencias, lecciones en el prompt y reglas propuestas que esperan a una persona. `MemoryApprovalStore` y `FileRuleStore`. `ReflectionEngine`, `DomainRegistry`, `FailureCatalog`, `PatternDetector`, `PolicyPromoter` y `ProceduralMemory` quedan `@deprecated`; se retiran en un minor posterior.
- **`agent-core`, opción única y tenants:** `createBaseEngine({ learning })` conecta el sink, el hook y, si el engine ya está en la ruta de política, las reglas aprobadas. Las experiencias llevan `tenantId` (el de `identity`), y patrones, lecciones, propuestas y reglas no cruzan tenants. El texto de una lección ya no lleva conteo ni fecha, para no invalidar la caché del prompt. El detalle que viene de una tool se sanea por separado.
- **`agent-core`, enseñar algo concreto:** `learning.teach(...)` guarda una lección escrita por una persona, sin esperar tres fallos: entra al prompt como `Taught lessons`, saneada y con tope de 500 caracteres, dentro de su tenant, y se puede limitar a un agente o a las tools que tenga en el turno. `learning.taught()` y `learning.forget(id)`. `learning.addRule(...)` añade una regla validada y atribuida a una persona. Solo quien permita `approverKinds` (por defecto una persona): un agente no puede enseñarse a sí mismo. `FileLessonStore` y `MemoryLessonStore`. `EnterpriseLearning` y `createCodingLearning` los guardan en archivos.
- **`agent-coding`:** con `orchestration`, los hallazgos de auditoría alimentan el aprendizaje (`createCodingLearning`, opción `learning`). Las reglas aprendidas **ya no se promueven solas** a `manifest.yaml`: quedan pendientes en `~/.{appName}/projects/<proyecto>/learning/` hasta que una persona las aprueba (`learning.approve`), y el orquestador las aplica. `reflection` deja de estar activo por defecto (`reflection: true` lo reactiva). El `manifest.yaml` anterior se sigue leyendo.
- **`agent-enterprise`:** `EnterpriseLearning` (umbral por severidad, la persona decide, reglas en el YAML del vault con `VaultRuleStore`). `EnterpriseReflection` queda `@deprecated`. `FlowRunner.reflection` acepta cualquier objeto con `recordGateOutcome`. `EnterpriseLearning` acepta `tenantId` y `VaultRuleStore` lo escribe en el YAML.

## v0.41.0 (2026-11-15)

[SPEC-0016](docs/specs/SPEC-0016-desamarrar-modulos-mixtos.md) F1–F3 (#182): la app de terminal sale de `agent-core`. **Con ruptura** en `agent-core` y `agent-coding`. En 0.x, `^0.39` no cubre 0.40, así que se barrieron los rangos de todos los paquetes y templates: `^0.40.0`, y en los peers `<0.42.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.40.0 | **rompe:** sin discovery, loader de skills, comandos integrados, workspace, checkpoint, trust ni seed; fuentes `agentSources`, `skillSources`, `instructionSources` |
| `agent-coding` | 0.30.0 | **rompe:** nuevo subpath `agent-coding/cli` con todo lo que salió de core |
| `mcp-server` 0.19.2 | patch | importa `SkillManager`, `SkillLoader` y `detectStack` de `agent-coding/cli`; requiere `agent-coding` ^0.30.0 |
| `create-bk-agent` 0.23.8, `agent-enterprise` 0.8.10, `agent-web` 0.6.7, `agent-providers` 0.3.7, `agent-sandbox` 0.1.10, `agent-testkit` 0.1.10, `agent-otel` 0.1.13, `orchestrator-agent` 0.7.5, `document-extract` 0.1.3, `aval-tools` 0.1.17 | patch | solo el rango de `agent-core` |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### Guía de migración

**Imports que se mueven.** Todo esto pasa de `@backendkit-labs/agent-core` a `@backendkit-labs/agent-coding/cli`: `discoverAgents`, `RemoteAgentRegistry`, `loadAgentsFromDir`, `globalAgentsDir`, `projectAgentsDir`, `SkillLoader`, `SkillManager`, `createSkillManager`, `parseMdSkill`, `skillToMd`, los proveedores de skills (`GitHubProvider`, `LocalProvider`, `SkillsShProvider`, `ObsidianProvider`), `registerBuiltinCommands`, los checkpoints, los workspaces, `runGlobalSeed`, `loadFrameworkConfig`, `DEFAULT_CONFIG` y el trust (`trustProject`, `isProjectTrusted`...).

**Siguen en core:** `SlashCommandRegistry`, `SkillRegistry`, `SkillActivator`, `cwdToProjectKey`, `getFrameworkDir`, `getProjectDir` y `atomicWrite`.

**`SkillActivator.detectStack`** pasa a la función `detectStack(cwd)` de `agent-coding/cli`.

**`agentDiscovery`** de `createBaseEngine` se sustituye por `agentSources`:

```ts
import { fileAgentSource } from '@backendkit-labs/agent-coding/cli';

createBaseEngine({ /* ... */ agentSources: [fileAgentSource({ appName: 'my-app' })] });
```

**Fuentes nuevas.** `skillSources` e `instructionSources` completan el trío. Las capas de instrucciones se sanean y entran al prompt por un hook `systemPrompt`, y un engine sin fuentes no toca el disco. `fileInstructionSource({ appName })` da `AGENT.md`, `USER.md`, contexto de proyecto, sesión y lecciones.

Quien usa `createCodingEngine` no cambia nada.

## v0.40.0 (2026-11-15)

[SPEC-0015](docs/specs/SPEC-0015-extraer-coding-de-los-contratos-de-core.md) F1–F4 (#179): el pipeline de coding sale de `agent-core`. **Con ruptura** en `agent-core` y `agent-coding`. En 0.x, `^0.38` no cubre 0.39, así que se barrieron los rangos de todos los paquetes y templates: `^0.39.0`, y en los peers `<0.41.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.39.0 | **rompe:** sin orquestador, QA, `store` ni `blockedCommands`; aprobación por hechos; `services` |
| `agent-coding` | 0.29.0 | **rompe:** el pipeline vive en `agent-coding/pipeline`; hooks de contexto |
| `create-bk-agent` 0.23.7, `mcp-server` 0.19.1, `agent-enterprise` 0.8.9, `agent-web` 0.6.6, `agent-providers` 0.3.6, `agent-sandbox` 0.1.9, `agent-testkit` 0.1.9, `agent-otel` 0.1.12, `orchestrator-agent` 0.7.4, `document-extract` 0.1.2, `aval-tools` 0.1.16 | patch | solo el rango de `agent-core` (y de `agent-coding` en `mcp-server`) |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### Guía de migración

**Pipeline de coding (orquestador y QA).** Las opciones `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA` y `onQAReview` desaparecen de `createBaseEngine` y `AgentEngine`. Se pasan como hooks:

```ts
import { Orchestrator, QAService, codingPipelineHooks } from '@backendkit-labs/agent-coding/pipeline';

createBaseEngine({ /* ... */ hooks: [codingPipelineHooks({ orchestrator, qaService, noQA, onQAReview, orchestratorFailureMode })] });
```

Quien usa `createCodingEngine` no cambia nada.

**Imports que se mueven.** `Orchestrator`, `QAService`, los tipos de orchestration y los hooks de reflection (`AuditHook`, `HistoricalLoader`, `LessonsMemoGenerator`…) pasan de `agent-core` a `agent-coding/pipeline`. Se elimina el subpath `agent-core/orchestration`. `agent-core/reflection` ya no hace falta: el núcleo se exporta desde la raíz.

**Aprobación de tools.** El engine ya no pregunta por `write_file`, `edit_file` ni `run_command` por su nombre. Una tool que antes preguntaba por llamarse así debe declarar `readOnly: false`. Para preguntar solo en ciertas llamadas, `alwaysAsk(args)`. El `packageInstallPolicy` de core pasa a `alwaysAsk` de `run_command`.

**`ExecutionContext`.** Se quitan `store` y `blockedCommands`, y las opciones `store` del engine. Se añade `services` (un `Record` o `(profile) => Record` en las opciones) y `getService(ctx, key)`. `agent-coding` usa las claves `coding.store` y `coding.blockedCommands`. `ProjectStoreData` y `SessionUpdates` pasan a `agent-coding`. `additionalRoots` se mantiene.

**System prompt.** Core solo escribe `## Working Directory`. La regla de rutas relativas y las notas del agente las añade `codingContextHooks`, al final del prompt.

## v0.39.0 (2026-11-14)

[SPEC-0014](docs/specs/SPEC-0014-puntos-de-extension-del-engine.md) completo (#171–#174): hooks de ciclo de vida, política y aprobación por llamada, aprobación durable y auditoría con un evento por llamada.

Sin cambio incompatible. Todo lo nuevo es opcional, y sin configurarlo el engine se comporta igual. `agent-core` sube a minor porque añade API pública. En 0.x, `^0.37` no cubre 0.38, así que se barrieron los rangos de todos los paquetes y templates: `^0.38.0`, y en los peers `<0.40.0`. Cada paquete que depende de core sube un patch solo por ese rango.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.38.0 | SPEC-0014: `policy`, `approver`, `approvals`, `audit`, `identity`, `hooks`; `FileApprovalStore`, `runApproved`, `consultAgent`; sinks de auditoría; servidor de tools con los mismos contratos |
| `mcp-server` | 0.19.0 | `AgentMCPServer` acepta `policy`, `approver`, `identity` y `auditSink` para las tools directas; requiere `agent-core` ^0.38.0 |
| `create-bk-agent` | 0.23.6 | templates con `agent-core` ^0.38.0; `add server` y `add knowledge` instalaban `mcp-server` ^0.15 y `enterprise` ^0.1 (en 0.x, versiones antiguas) y ahora piden ^0.19.0 y ^0.8.8 |
| `agent-coding` 0.28.5, `agent-enterprise` 0.8.8, `agent-web` 0.6.5, `agent-providers` 0.3.5, `agent-sandbox` 0.1.8, `agent-testkit` 0.1.8, `agent-otel` 0.1.11, `orchestrator-agent` 0.7.3, `document-extract` 0.1.1, `aval-tools` 0.1.15 | patch | solo el rango de `agent-core` |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### `mcp-server`: gobernanza de las tools directas (SPEC-0014 F4)
- `AgentMCPServer` reenvía `policy`, `approver`, `identity` y `auditSink` a sus `directTools`. Son los mismos contratos que el engine y que `createToolServer`.
- Una tool directa `destructive` puede tener como gate una `policy` en vez de `authorize`.
- `audit(ToolCallRecord)` queda obsoleto, sin cambios.

### `agent-core`: contratos de gobernanza y auditoría por llamada ([SPEC-0014](docs/specs/SPEC-0014-puntos-de-extension-del-engine.md) F0–F1)
Sin cambio incompatible: todo es opcional y el engine se comporta igual si no se configura.
- **Contratos** (exportados desde la raíz): `Principal`, `Identity`, `ToolCall`, `PolicyDecision`, `ToolPolicy`, `ApproverRef`, `ApprovalSubject`, `ApprovalRequest`, `ApprovalOutcome`, `Approver`, `ApprovalStore`, `AuditEvent` y `AuditSink`. La política y la aprobación se conectan al engine en F2.
- **`audit` en `createBaseEngine` y `AgentEngine`:** uno o varios `AuditSink` reciben exactamente un `AuditEvent` por llamada a tool, sea permitida, fallida, con timeout, inexistente, no autorizada, rechazada o bloqueada por guardrail o por el sandbox. También reciben uno por cada delegación `ask_agent`.
  - Los argumentos van solo como SHA-256 del JSON canónico.
  - Las decisiones del sandbox durante la llamada van dentro del mismo evento.
  - Si un sink falla, se avisa en el transport y el resultado no cambia.
- **`identity`:** tenant, usuario y roles que forman parte del principal de cada llamada.
- **Sinks:** `MemoryAuditSink`, `NdjsonAuditSink` y `HashChainAuditSink`. Este último encadena hashes con HMAC opcional y se verifica con `verifyAuditChain` y `verifyAuditSegment`; es el mismo esquema que la gobernanza de Steward. Se rechaza extender un log que ya está alterado.
- **`auditLog` (ruta a NDJSON) queda obsoleto** sin cambiar su formato: sigue escribiendo hasta 200 caracteres de argumentos en claro. Se retira en 0.40.
- **Base común (F0):** `hashArgs` y `canonicalJson` en un solo módulo; `isLoopbackRequest` en un solo sitio, que `mcp-server` reexporta.

### `agent-core`: política y aprobación por llamada (SPEC-0014 F2)
Sin cambio incompatible. La ruta nueva se activa solo al configurar `policy`, `approver` o `approvals`. Sin ellas, `onToolApproval` se comporta exactamente igual que antes.
- **`policy`:** una o varias `ToolPolicy` deciden `allow`, `deny` o `ask` sobre cada llamada a tool y cada delegación `ask_agent`. Deciden sobre los argumentos que de verdad se ejecutarían, después de `allowedTools`, el sandbox y los guardrails.
  - Si hay varias, `deny` gana sobre `ask`, y `ask` gana sobre `allow`.
  - Una política que lanza un error deniega.
  - `allow` puede pedir los modos `sandboxed` o `dry_run`. Este último hace que la tool vea `ctx.dryRun`.
- **`defaultToolPolicy`:** se aplica cuando hay a quién preguntar y no se dio `policy`. Lo `readOnly` se ejecuta. Lo `destructive` pregunta siempre a una persona. Lo demás pregunta.
- **`approver`:** responde a cada `ask`. Puede ser una persona, otro agente o un servicio como Hermes. El engine valida cada respuesta: el tipo de aprobador debe estar aceptado, nadie se aprueba a sí mismo ni a su cadena, y un agente solo aprueba lo que él mismo puede hacer. La auditoría registra quién aprobó.
  - Sin `approver`, se adapta `onToolApproval` con `approverFromCallback`. "Aprobar todo" nunca cubre lo destructivo ni la instalación de paquetes.
- **`approvals`:** si nadie responde en el momento, la llamada queda pendiente en el almacén y no se ejecuta. Si no hay nadie a quién preguntar, se rechaza.
- **Contexto de cada tool:** `ctx.principal` con el agente, su cadena de delegación y la identidad del engine. La cadena se propaga en las delegaciones.

### `agent-core`: hooks de ciclo de vida (SPEC-0014 F3)
Sin cambio incompatible: sin `hooks` el engine no cambia.
- **`hooks: EngineHooks[]`:** seis puntos de enganche.
  - `beforeRun`: antes de que empiece el turno.
  - `systemPrompt`: añade secciones al prompt del agente activo y al de los delegados.
  - `afterTurn`: se llama cuando el modelo responde sin pedir tools. Puede forzar otra pasada con `{ action: 'continue', agentId?, message? }`, con un tope de `maxHookContinues` (5 por defecto).
  - `beforeTool` y `afterTool`: envuelven solo las llamadas que la política permitió.
  - `afterRun`: al terminar el turno.
- **Turno:** los hooks se ejecutan en orden de registro y comparten un `RunContext` (principal, input, `state` y `signal`).
- **Errores:** un hook que lanza falla el turno, igual que un orquestador en modo `closed`.
- **Pipeline de coding:** se puede expresar solo con hooks (hay un test que lo demuestra). Se migrará en SPEC-0015.

### `agent-core`: servidor de tools con los mismos contratos, y aprobación durable (SPEC-0014 F4–F5)
Sin cambio incompatible.
- **`createToolServer`** acepta `policy`, `approver`, `identity` y `auditSink`.
  - `auditSink` recibe el mismo `AuditEvent` que el engine.
  - Un `ask` sin aprobador se rechaza.
  - Una tool `destructive` arranca con `authorize` o con `policy`.
  - Cada tool recibe `ctx.principal`, y `ctx.dryRun` cuando la política pide simular.
  - `audit(ToolCallRecord)` queda obsoleto, sin cambios.
- **`FileApprovalStore`:** guarda las aprobaciones pendientes en un directorio. Admite una sola decisión y una sola ejecución por id. Cada paso es atómico entre procesos, sin locks, y la petición sobrevive a reinicios.
- **`engine.runApproved(id)`:** ejecuta, como mucho una vez, una llamada que quedó pendiente y luego fue aprobada. Repite todas las comprobaciones, y la aprobación solo cuenta si su aprobador es de un tipo aceptado.
- **`engine.consultAgent(id, pregunta)`:** permite preguntarle algo a otro agente.
- **`agentApprover`:** un agente supervisor como aprobador. Responde APPROVE o REJECT.
- **`consoleApprover`:** una persona en la terminal como aprobador, con y/N.
- **Regla 3 precisada:** un agente aprueba si la política, evaluada con él como principal, le daría `allow`, o un `ask` que un agente puede satisfacer.

## v0.38.2 (2026-11-14)

Publicado en npm (los dos paquetes de la tabla, cada versión es `latest`) y taggeado `agent-core@0.37.2` y `mcp-server@0.18.6` sobre el merge del bump (a833d35e). Tools directas (sin LLM) servidas por MCP, [SPEC-0011](docs/specs/SPEC-0011-mcp-server-tools-directas.md) D1–D4 (#166); arreglo del CI que re-resolvía dependencias al instalar el binario de rolldown (#169). Patch en los dos paquetes: el cambio es aditivo y los rangos `^0.37.0` existentes (paquetes, templates, consumidores) toman `agent-core` 0.37.2 sin editar nada.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.2 | hechos declarados en `ToolDefinition`, `createToolContext`, servidor MCP de tools directas (`createToolServer`, `startToolServerHttp`, `runToolServer`, `createToolRegistrar`) |
| `mcp-server` | 0.18.6 | `AgentMCPServer` con `directTools`; `engineFactory` opcional; requiere `agent-core` ^0.37.2 |

Los demás paquetes no cambian.

El framework queda como SDK para crear agentes; la infraestructura vive en `bk-platform` (mismos nombres npm, versiones sin cambio). Salen de este repo: `hermes` (0.4.0), `curator-codex-agent`, `dataset-curator-agent` e `infra`; las specs SPEC-0003 y SPEC-0008 pasan a `bk-platform/docs/hermes`. `orchestrator-agent` sigue aqui hasta que `bk-platform` migre a zod 4. Tambien salen `apps/docs` y `apps/bk-agent`.

### `agent-core`: servidor MCP de tools directas y hechos declarados de una tool ([SPEC-0011](docs/specs/SPEC-0011-mcp-server-tools-directas.md))
Sin cambio incompatible: los campos nuevos son opcionales y están ausentes si no se declaran; `AgentToolDef` y `AgentMCPServer` de `mcp-server` no cambian.
- **`ToolDefinition` / `defineTool`:** `title`, `readOnly` (implica `concurrencySafe`), `destructive`, `idempotent`, `openWorld` y `meta` (libre, el engine no lo lee). Las contradicciones (`readOnly` + `destructive`, `destructive` + `concurrencySafe`, `timeoutMs` no positivo, `parameters` que no es objeto) lanzan `ToolDefinitionError` al definir la tool. `validateToolDefinition(tool)` para tools escritas a mano; `getToolInputSchema(tool)` devuelve el esquema Zod con el que se definió.
- **`createToolContext(opts?)`:** `ExecutionContext` para ejecutar una tool fuera de un `AgentEngine` (memoria en proceso, `askAgent` que rechaza). `createInMemorySessionMemory()`.
- **`createToolRegistrar(opts)`:** valida las tools una vez y devuelve una función que las registra, con las mismas garantías, en cualquier `McpServer` (uno que también sirva tools de prompt o recursos).
- **`createToolServer(opts)` / `createToolServerFactory(opts)`** (también en `@backendkit-labs/agent-core/mcp`): expone `ToolDefinition`s como tools MCP que ejecutan directo, sin modelo. Las tools de `defineTool` se registran con su propio esquema Zod (sin conversión); las escritas a mano pasan por `z.fromJSONSchema` y fallan fuerte si el esquema no se puede expresar. Por llamada: `authorize` (obligatorio si alguna tool es `destructive`; el servidor no arranca sin él), `ExecutionContext` con `signal` que aborta por cancelación del cliente o por `timeoutMs`, tope de salida (`maxOutputChars`, 1 048 576) y registro `audit` con hash SHA-256 de los argumentos. Contrato: `isError` solo si la llamada no terminó (denegada, timeout, excepción sin stack, salida demasiado grande); lo que la tool devuelve es payload. `annotations` (`readOnlyHint`...), `title` y `_meta` salen de los hechos declarados.
- **`startToolServerHttp(opts, http)`:** Streamable HTTP sin estado (un servidor y un transporte por petición), bearer obligatorio comparado en tiempo constante, se niega a escuchar fuera de loopback sin token, 403 si `Host`/`Origin` no son loopback, solo `POST`, 413 por encima de `maxBodyBytes`.
- **`runToolServer(opts, cli)`:** la CLI `bk-mcp` de siempre (stdio por defecto, `--http --port --host --token`, variable de entorno configurable, `--help`); `parseToolServerArgs` y `toolServerUsage` sueltos.
- **`MCPClientManager`:** con `trustAnnotations: true` copia también `destructiveHint`, `idempotentHint`, `openWorldHint` y `_meta` (a `destructive`, `idempotent`, `openWorld`, `meta`); `readOnlyHint` sigue dando `concurrencySafe` y ahora también `readOnly`. `title` se copia siempre. Sin `trustAnnotations` nada cambia.

### `mcp-server`: `AgentMCPServer` sirve también tools directas (SPEC-0011 D4)
Sin cambio incompatible: `tools: AgentToolDef[]` y `buildPrompt` no cambian.
- **`directTools?: ToolDefinition[]`** junto a `tools`, con `authorize`, `audit`, `context`, `maxOutputChars` y `toolTimeoutMs`; se registran con `createToolRegistrar` de `agent-core` en el servidor de cada sesión (el `audit` recibe el id de sesión MCP).
- **`engineFactory` opcional**: un servidor solo con tools directas no necesita engine. El constructor lanza si hay tools de prompt sin `engineFactory`, si un nombre está en las dos listas o si una tool directa `destructive` no tiene `authorize`.
- **Requiere `agent-core` ^0.37.2** (`createToolRegistrar`).

## v0.38.1 (2026-10-28)

Publicado en npm (los 7 paquetes de la tabla, cada versión es `latest`) y taggeado `<paquete>@<versión>` sobre el merge del bump (56f43573). Correcciones de seguridad portadas desde el fork de Steward (inventario SPEC-0001 de Steward, G1–G10; #159–#162), el paquete nuevo `document-extract` ([SPEC-0012](docs/specs/SPEC-0012-extraccion-de-documentos.md), #163) y el cierre documental de v0.38.0 (#158). Sin cambio incompatible: los valores por defecto del modo estricto no cambian. Sin ejecutar en GitHub Actions (no arranca por facturación): build en el orden del CI, typecheck de todos los paquetes, tests con cobertura, `audit-gate`, `check-resilience` y `madge` se corrieron en local sobre el árbol integrado.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.1 | `appName` validado, `atomicWrite` con temporal único, saneo del contexto de disco, SSRF en el registro remoto |
| `agent-coding` | 0.28.4 | `realpath` en el sandbox de archivos, plazo en `search_files`, aviso de secretos en `save_*` |
| `agent-enterprise` | 0.8.7 | el gate de `FlowRunner` que no se puede evaluar falla en vez de pasar |
| `agent-web` | 0.6.4 | HMAC del webhook sobre bytes crudos; modo `strict` opcional |
| `agent-web-ui` | 0.1.3 | el token va como subprotocolo, nunca en la URL |
| `agent-protocol` | 0.6.2 | modo `strict` opcional; aviso al escuchar fuera de loopback sin `apiKey` |
| `document-extract` | 0.1.0 | **nuevo**: PDF, Word, Excel, CSV y OCR a texto |

Los demás paquetes no cambian (sus rangos `^0.37.0` y `<0.38.0` cubren `agent-core` 0.37.1).

### Correcciones de seguridad (#159, #160, #162)
- **`agent-coding`:** `resolveAndCheck` compara rutas reales: un enlace dentro del directorio de trabajo que apunta fuera ya no escapa del sandbox de las tools de archivo. `search_files` devuelve `Error: ...` en vez de lanzar. **Cambio visible:** leer por un enlace que sale del workspace ahora falla también sin sandbox.
- **`agent-coding` — `search_files`:** el patrón lo escribe el modelo y una expresión con retroceso catastrófico (`(a+)+$`) colgaba al agente varios segundos con 24 caracteres. La búsqueda corre ahora con un plazo de 5 s (`BK_SEARCH_FILES_TIMEOUT_MS`) y devuelve `Error: search stopped...` si lo agota.
- **`agent-core`:** `appName` solo admite letras, dígitos, guion y guion bajo (antes `../x` salía del home). `atomicWrite` usa un temporal único por escritura.
- **`agent-core`:** el contexto que se lee de disco (AGENT.md, USER.md, proyecto, sesión) se sanea antes de entrar al prompt: se quitan delimitadores de chat y etiquetas de rol, sin tocar genéricos ni marcado. El registro remoto de agentes valida el protocolo y no sigue a IP privadas distintas de su propio origen (no cubre DNS rebinding).
- **`agent-coding`:** `save_context`, `save_audit`, `save_learning` y `update_session` avisan si el texto parece contener secretos.
- **`agent-web`:** el HMAC del webhook se verifica sobre los bytes recibidos y no sobre `JSON.stringify(req.body)`.
- **`agent-enterprise` — `FlowRunner` (visible):** un paso cuyo gate declara `criteria` pero no se puede evaluar (el flujo no nombra `evaluator`, o falta `onGateRequired`) ahora **falla** con `ComplianceGateError` en vez de pasar en silencio. Un gate con `approval: human` no se bloquea: la persona es la evaluación. Transitorio: `allowUnevaluatedGates: true` restaura el comportamiento anterior.

### Modo estricto (opcional, no cambia los valores por defecto) (#161)
- **`agent-web`:** `new AgentServer({ strict: true })` no permite ningún origen CORS salvo los de `cors`, añade `X-Content-Type-Options`, `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`, y lanza si escucha en una interfaz no local sin `auth`. `new JwtAuth({ allowQueryToken: false })` ignora `?token=`; el navegador envía el JWT como subprotocolo `bearer, <jwt>`. El servidor selecciona `bearer` siempre (hace falta para ese cliente). `JwtAuth` acepta ahora ese subprotocolo también sin `strict`.
- **`agent-web-ui`:** `useAgentSession` y `useKanbanMonitor` aceptan `token` y lo envían como subprotocolo, nunca en la URL.
- **`agent-protocol`:** `new AgentServer({ strict: true })` lanza si `host` no es de loopback y no hay `apiKey`. Sin `strict`, esa combinación solo avisa al arrancar (`console.warn` nuevo).

### `document-extract` 0.1.0 (#163)
Texto de PDF con capa de texto, Word (.docx), Excel (.xlsx), CSV y texto, con límites (tamaño, páginas, ZIP descomprimido, caracteres) y errores de código estable; herramienta `read_document` que consulta el sandbox como `read_file`. OCR opcional de imágenes PNG/JPEG y PDF escaneados con `tesseract.js` (instalado, nunca descarga; sin él `OCR_UNAVAILABLE`); `@napi-rs/canvas` opcional para PDF que no son una imagen por página. Node ≥ 22. Límites conocidos en el [README](packages/document-extract/README.md) y en SPEC-0012 §4 y §6.

## v0.38.0 (2026-10-26)

Publicado en npm (los 14 paquetes, cada versión es `latest`) y taggeado `<paquete>@<versión>` sobre el merge del bump (4b74bc83). Sin verificar: el claim de aprobaciones entre procesos contra un Redis real; GitHub Actions no arranca por facturación, así que lo mergeado en 0.37.x–0.38.0 se validó solo en local.

Cierre de [SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) (O2–O5, #141–#156). **Cambio incompatible en `agent-core`** (#155): un agente solo puede llamar a las herramientas de su `allowedTools`. Rangos 0.x barridos: `agent-core ^0.37.0` y peers `<0.38.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.0 | `allowedTools` vacío = sin herramientas; `discoverAgents` con confianza del workspace; contexto de sub-agentes |
| `orchestrator-agent` | 0.7.2 | `applyGateDecision` testeable; aprobación de gates atómica entre procesos |
| `agent-web` | 0.6.3 | `SessionManager.get` sin escritura por mensaje; `SCAN`/`MGET` en Redis |
| `agent-enterprise` | 0.8.6 | escaneo del vault sin copias ni `stat` secuencial |
| `mcp-server` | 0.18.5 | sesiones HTTP con TTL y tope |
| `mcp-connectors` | 0.2.2 | token de gcal en single-flight |
| `agent-web-ui` | 0.1.2 | tokens aplicados por fotograma |
| `create-bk-agent` | 0.23.5 | `add mcp-client`/`add plugin` generan código que compila; plantillas sin código muerto y con `agent-providers` |
| `agent-coding` | 0.28.3 | solo el rango de `agent-core` |
| `agent-providers` | 0.3.4 | solo el peer de `agent-core` |
| `agent-otel` | 0.1.10 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.7 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.7 | solo el peer de `agent-core` |
| `aval-tools` | 0.1.14 | solo el rango de `agent-core` |

`agent-protocol` (0.6.1) y `agent-infra` no cambian.

**Orden de publicación:** core → providers → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server, mcp-connectors, web-ui) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **INCOMPATIBLE — `allowedTools: []` significa sin herramientas (`agent-core`).** Antes un agente con `allowedTools` vacío y sin `delegatesTo` podía ejecutar cualquier herramienta registrada si el modelo la llamaba por nombre. Ahora solo puede llamar a las que lista. Arreglo: poner en `allowedTools` los nombres de las herramientas que debe usar. Para ganar tiempo: `allowUnlistedTools: true` (en `AgentEngine` y `createBaseEngine`) restaura el comportamiento anterior solo para ese caso; no es para dejarlo puesto. Los perfiles de `agent-coding` y las plantillas `single` / `multi-agent` ya listan sus herramientas.
- **`discoverAgents` / `createBaseEngine({ agentDiscovery })` (`agent-core`): la capa de proyecto exige confianza del workspace.** Los agentes de `.{app}/agents/` del repositorio no se cargan salvo que el proyecto sea de confianza (`/trust add`, `BK_TRUST_PROJECT=1`) o el host pase `trusted: true`. Si no, no se abre ni se parsea ningún archivo y se avisa con los nombres. Era el mismo hueco que `AgentLoader` ya cerraba (SPEC-0009). Además, con un mismo id en proyecto y global, **gana el proyecto** (antes el global), y el directorio personal y la caché del registro usan `getFrameworkDir`.
- **Contexto (`agent-core`):** los sub-agentes aplican la compactación por tokens de `context` y reintentan una vez ante un error de contexto demasiado largo. `ContextManager` recorta además los resultados voluminosos de herramientas antiguos **dentro** de un turno largo (`keepRecentToolResults`, 4); afecta también al agente principal.
- **`orchestrator-agent`:** el claim de la aprobación de un gate también se toma en el store (Redis `SET NX PX`, o un archivo `<run>.claim` en disco, 5 min de TTL); dos procesos ya no pueden aprobar el mismo gate. No se ha probado contra un Redis real.
- **`agent-web`:** la última actividad de una sesión se persiste como mucho cada 30 s (`activityPersistIntervalMs`); `RedisLike` admite `scan`/`mget` opcionales.
- **`mcp-server`:** una sesión HTTP inactiva más de 30 min se cierra; con 1000 abiertas, las nuevas reciben 503 (`sessionTtlMs`, `maxSessions`).
- **`agent-web-ui`:** el texto en streaming llega a la UI hasta ~16 ms más tarde.
- **`create-bk-agent`:** las plantillas `single` y `multi-agent` generan proyectos que usan `@backendkit-labs/agent-providers` (y ya no fijan `openai ^4`); `add mcp-client` / `add plugin` registran el servidor con `mcpManager` en proyectos con `new AgentEngine`. Se eliminan las plantillas legacy de primer nivel.

## v0.37.2 (2026-10-26)

Cotas, cachés y exportación acotada ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O3, #136–#139). Solo patches: los rangos de los dependientes ya los cubren, sin barrido ni cambio en `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.2 | topes por defecto en memoria semántica (5000) y procedural (1000) |
| `agent-otel` | 0.1.9 | tags de los spans de core exportados por lista blanca |
| `agent-enterprise` | 0.8.5 | `ObsidianRAGProvider` guarda el índice por tiempo, no por batch |
| `orchestrator-agent` | 0.7.1 | cachés del store de runs (episódica) y del índice RAG |

**Orden de publicación:** core → enterprise → orchestrator-agent → otel.

### Cambios de comportamiento
- **`agent-core`:** `SemanticMemory` conserva las 5000 entradas más nuevas y `ProceduralMemory` 1000 patrones (descarta los menos confirmados). Se ajusta con `retention.maxKnowledge` / `maxPatterns`; `Infinity` quita el tope.
- **`agent-otel`:** un tag no listado en un span de core (`run`, `agent_block`, `llm_call`, `tool_call`) deja de exportarse. Los spans creados por la propia aplicación siguen pasando sus tags.
- **`agent-enterprise`:** nueva opción `checkpointIntervalMs` (30 s); `0` restaura el guardado por batch. Un crash pierde como mucho ese intervalo de indexación.
- **`orchestrator-agent`:** el índice RAG se reutiliza 2 min y la lista de pasos episódicos 60 s; una nota nueva del vault tarda hasta 2 min en verse para runs nuevos.

## v0.37.1 (2026-10-26)

Cotas y fugas ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O3, #128–#133). Solo patches: los rangos `^0.36`, `^0.3`, `^0.6` y `^0.18` de los dependientes ya los cubren, así que no hay barrido de rangos ni cambio en `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.1 | `MCPClientManager` cierra cliente y transport si la conexión falla (sin procesos stdio huérfanos) |
| `mcp-server` | 0.18.4 | `indexDirectory` con concurrencia acotada (16) |
| `agent-protocol` | 0.6.1 | `TaskStore` evicta tareas canceladas y las que nunca terminan (24 h) |
| `agent-providers` | 0.3.3 | sin reintento tras emitir razonamiento |
| `agent-otel` | 0.1.8 | `otlpHttpExporter` con cola acotada (`maxQueuedBatches`) |
| `agent-web` | 0.6.2 | backpressure en WebSocket |

**Orden de publicación:** core → providers → agent-protocol → (otel, mcp-server, web).

### Cambios de comportamiento
- **`agent-web`:** un cliente de sesión que deja más de 8 MiB sin leer se desconecta (código 1013 `slow consumer`); `new WebSocketTransport(socket, { maxBufferedBytes })` lo ajusta. A los observadores del monitor se les omiten frames pasado 1 MiB (`MonitorBus.droppedFrames`).
- **`agent-otel`:** con un collector lento, los lotes más antiguos por encima de `maxQueuedBatches` (32) se descartan y se avisa por `onError`; antes se acumulaban sin tope.
- **`agent-protocol`:** `evict(ttlMs, activeTtlMs)` descarta además tareas pending/running con más de 24 h.

## v0.37.0 (2026-10-26)

Auditoría de orquestación, límites y cotas ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O1–O3, #110–#126) y los ejemplos migrados a zod 4. Rangos 0.x barridos: `agent-core ^0.36.0` y peers `<0.37.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.0 | orquestación, límites y cotas (abajo) |
| `agent-coding` | 0.28.2 | `run_command` valida los binarios envueltos; rango de `agent-core` |
| `orchestrator-agent` | 0.7.0 | una gate por paso, plan validado, `approve` unificado |
| `agent-enterprise` | 0.8.4 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.3 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.13 | solo el rango de `agent-core` |
| `agent-web` | 0.6.1 | solo el rango y el peer de `agent-core` |
| `agent-otel` | 0.1.7 | solo el peer de `agent-core` |
| `agent-providers` | 0.3.2 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.6 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.6 | solo el peer de `agent-core` |
| `create-bk-agent` | 0.23.4 | plantillas con los rangos nuevos |

`agent-protocol`, `agent-infra`, `mcp-connectors` y `agent-web-ui` no cambian. Los 8 ejemplos de `examples/` y `finance-managment` pasan a zod ^4.6.6 y core 0.35.

**Orden de publicación:** core → providers → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **`orchestrate()` falla cerrado (`agent-core`).** Si el orquestador lanza, `run()` falla con `Orchestrator failed; refusing to run without its gates` en vez de ejecutar sin gates en silencio. Para el comportamiento anterior (con aviso `warn`): `orchestratorFailureMode: 'open'`.
- **Historial en memoria acotado a 200 mensajes por defecto (`agent-core`).** Antes era ilimitado. `maxContextMessages: 0` lo desactiva; no se aplica si configuras `context` (control por tokens).
- **`JsonFileStore` cambia de formato en disco (`agent-core`).** Pasa de un array JSON a un log de líneas JSON. Los archivos antiguos se leen y se convierten solos en la primera carga; una herramienta externa que lea esos archivos como array dejará de funcionar.
- **Delegaciones anidadas con tope (`agent-core`).** Un bulkhead por nivel de profundidad (antes las anidadas no esperaban nunca) y `maxDelegationDepth` (5): una delegación más profunda falla con `max_depth_exceeded`. `WorkflowRunner` limita las olas a `maxConcurrency` (8).
- **FSM de tareas (`agent-core`).** Se quita `approved → implementation` (volver a editar un cambio aprobado pasa por `rework_required`) y el rework tiene tope (`maxRework`, 5; agotado, la tarea se rechaza).
- **`QAService.evaluateReview` por palabras completas (`agent-core`).** Antes `broken` contenía `ok` y aprobaba. Veredictos de revisiones que antes salían aprobadas por error pueden cambiar.
- **`WorkflowRunner` (`agent-core`).** Un fallo salta toda la cadena de dependientes; un ciclo o una dependencia desconocida se reporta como `failed` en lugar de `completed` con pasos faltantes.
- **`abort()` cancela también las llamadas LLM de los sub-agentes (`agent-core`).**
- **`EpisodicMemory` y `MetricsCollector` (`agent-core`).** La summarization reemplaza los episodios que resume (antes solo añadía el resumen); los percentiles de runs son una estimación sobre un reservorio de 1024 (exactos por debajo).
- **`run_command` (`agent-coding`)** valida el binario que envuelven `env`, `xargs`, `timeout` y `find -exec`, y rechaza `$(…)`/backticks dentro de comillas dobles. Sigue siendo un guard rail: la contención real es el sandbox.
- **`orchestrator-agent`:** con varias gates en un mismo lote, cada una se pide por separado (antes solo la primera); el plan se rechaza con ciclos, ids duplicados o `agent_id` desconocido; `subtaskTimeoutMs` opcional; la ruta HTTP de `approve` ahora deja rastro de auditoría.

## v0.36.0 (2026-10-26)

Presupuesto diario aplicado (SPEC-0009 C3b, ADR-0007 §5). `limits.budgetUsdPerDay` y `policies.budget.perDayUsd` dejan de ser solo declarativos, para los agentes que informan su coste. Cambio aditivo en `agent-protocol`; un agente que no informa su coste sigue sin límite.

- `agent-protocol`: `AgentContext.reportCost(usd)` en los handlers del `AgentServer`; `costUsd` opcional en `RunResponse` y `TaskRecord`.
- `hermes`: `RunOutcome.costUsd`, `RunRecord.costUsd` y `RunView.costUsd`; `handler(input, signal, run)` del `InProcessConnector` con `run.reportCost`. El acumulado diario (día UTC del inicio) sale del store de runs, así que sobrevive reinicios. Nuevo error `BUDGET_EXCEEDED` al admitir un run con el presupuesto agotado (tope blando: un run en curso termina). `bk-hermes validate` reformula los avisos de presupuesto; `perRunUsd` sigue sin aplicarse.
- `hermes`: `engineRunCost(engine)` lee el coste del último run de un `AgentEngine` con `observability`, para pasarlo a `run.reportCost`.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.6.0 | `reportCost` y `costUsd` (aditivo) |
| `hermes` | 0.4.0 | presupuesto diario aplicado, `BUDGET_EXCEEDED`, `engineRunCost`; peer de `agent-protocol` ampliado a <0.7.0 |

## v0.35.0 (2026-10-26)

Defaults seguros. Tres servidores HTTP arrancaban abiertos por defecto: ahora lo seguro es el default y lo abierto hay que pedirlo. Rangos 0.x barridos: `agent-core ^0.35.0` en los paquetes que dependen de él, peers `<0.36.0` y plantillas de `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.35.0 | `secret` obligatorio en webhooks |
| `agent-protocol` | 0.5.0 | `AgentServer` en `127.0.0.1`, opción `host` |
| `agent-web` | 0.6.0 | `AgentServer` en `127.0.0.1` |
| `hermes` | 0.3.1 | solo rangos de `agent-core` y `agent-protocol` |
| `agent-coding` | 0.28.1 | solo el rango de `agent-core` |
| `agent-enterprise` | 0.8.3 | solo el rango de `agent-core` |
| `orchestrator-agent` | 0.6.2 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.2 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.12 | solo el rango de `agent-core` |
| `agent-otel` | 0.1.6 | solo el peer de `agent-core` |
| `agent-providers` | 0.3.1 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.5 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.5 | solo el peer de `agent-core` |
| `create-bk-agent` | 0.23.3 | plantillas con los rangos nuevos |

`agent-infra`, `mcp-connectors`, `curator-codex-agent` y `agent-web-ui` no cambian.

**Orden de publicación:** core → agent-protocol → providers → hermes → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **`WebhookServer` / triggers `webhook` (`agent-core`): `secret` obligatorio.** Sin `secret`, cualquiera que alcance el puerto podía hacer que el agente ejecutara un prompt. `register()` y `TriggerManager.start()` ahora lanzan un error si una ruta no lo tiene. Si de verdad no quieres firma (puerto no alcanzable por terceros), declara `allowUnsigned: true` en el trigger. Arreglo normal: `{ type: 'webhook', path: '/x', secret: process.env.WEBHOOK_SECRET }`.
- **`AgentServer` (`agent-web` y `agent-protocol`): escucha en `127.0.0.1` por defecto** (antes `0.0.0.0` / todas las interfaces). Para aceptar llamadas remotas, en contenedores o detrás de un proxy en otro host: `host: '0.0.0.0'` (y configura `auth` / `apiKey`). `agent-protocol` gana la opción `host`.
- Ejemplo `marketing-co`: los agentes leen `HOST` (por defecto `127.0.0.1`); su Dockerfile fija `HOST=0.0.0.0`.

## v0.34.0 (2026-10-24)

Confianza del workspace (#99) y límites de Hermes (#100): fases C1 y C3 de [SPEC-0009](docs/specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md), con [ADR-0006](docs/adr/0006-confianza-del-workspace.md) y [ADR-0007](docs/adr/0007-un-limite-declarado-debe-aplicarse.md). Rangos 0.x barridos: `agent-core ^0.34.0` y `agent-coding ^0.28.0` en los paquetes que dependen de ellos y en las plantillas de `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.34.0 | confianza del workspace, `/trust` |
| `agent-coding` | 0.28.0 | agentes de proyecto solo en proyectos confiados; necesita `agent-core >= 0.34` |
| `hermes` | 0.3.0 | `maxConcurrent` aplicado, avisos de presupuesto |
| `agent-enterprise` | 0.8.2 | solo el rango de `agent-core` |
| `orchestrator-agent` | 0.6.1 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.1 | solo los rangos de `agent-core` y `agent-coding` |
| `agent-web` | 0.5.1 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.11 | solo el rango de `agent-core` |
| `create-bk-agent` | 0.23.2 | plantillas con los rangos nuevos |

`agent-sandbox`, `agent-protocol`, `agent-providers`, `agent-otel`, `agent-testkit`, `curator-codex-agent` y `mcp-connectors` no cambian. Sus peers sobre `agent-core` (`<0.35.0`) ya cubren la 0.34.

**Orden de publicación (obligatorio):** core → hermes → coding → enterprise → orchestrator-agent → (aval-tools, web, mcp-server) → create-bk-agent.
`agent-coding` 0.28.0 importa `isProjectTrusted` de `agent-core`: publicarlo antes que `agent-core` 0.34.0 rompe las instalaciones. `mcp-server` depende de `agent-coding ^0.28.0`, así que va después de él.

### Cambios de comportamiento (léelos antes de actualizar)
- **`agent-core` 0.34.0 y `agent-coding` 0.28.0 — los agentes y skills de proyecto ya no cargan solos.** Lo que hay en `{proyecto}/.bk-agent/agents/` y `{proyecto}/.bk-agent/skills/` es contenido del repositorio abierto, no tuyo: un repo clonado podía traer un agente que reemplazaba al orquestador builtin con su propio prompt y herramientas. Ahora esa capa solo carga si confías en el proyecto:
  - Una vez por proyecto: `/trust add` (también `/trust status`, `remove` y `list`). Se guarda en `~/.bk-agent/trusted-projects.json`. Las skills cargan al momento; los agentes, al siguiente arranque.
  - Para CI y contenedores: `BK_TRUST_PROJECT=1`. Para un host que decide por sí mismo: `createCodingEngine({ trustedProject: true | false })`.
  - La confianza es por **ruta exacta**: confiar en `~/code` no confía en un clon dentro. Un archivo de confianza dañado significa que nadie es confiable.
  - Si el proyecto no está confiado, el engine avisa con `[Trust]` de qué se dejó fuera. Tus agentes y skills globales de `~/.bk-agent/` siguen cargando, y el mecanismo de override `.md` y la precedencia se mantienen para proyectos confiados.
  - `AgentLoader` ya no crea directorios dentro de un proyecto no confiado, y calcula el directorio global con `getFrameworkDir` como el resto del framework.
  - **No incluye** `AGENT.md`: el repositorio sigue pudiendo aportarlo al prompt (pregunta abierta nº 6 de SPEC-0009).
- **`hermes` 0.3.0 — `limits.maxConcurrent` ahora se aplica.** Antes se aceptaba y no hacía nada. Pasado el límite, una llamada nueva falla al instante con `AGENT_BUSY` (no se encola), y quien llama decide si reintenta. Cuenta runs de capabilities, no flows. Un run recuperado tras un reinicio ocupa hueco hasta que termina.
- **`hermes` 0.3.0 — presupuestos.** El presupuesto de un blueprint ya no es obligatorio cuando el creador tiene techo (declarar más que el techo sigue siendo un error). `bk-hermes validate` imprime un `warning:` en stderr por cada presupuesto declarado que nada aplica (el del agente, el del blueprint, `policies.budget`); el código de salida no cambia. **Los presupuestos siguen siendo solo declarativos**: Hermes no mide el gasto de los agentes que supervisa.

### Detalle
- **core:** módulo `trust/workspace-trust` (`isProjectTrusted`, `trustProject`, `untrustProject`, `listTrustedProjects`, `projectLayerContents`, `untrustedLayerWarning`); `SkillLoader.loadProject(cwd, trusted?)` y `loadAll(cwd, projectDir, trusted?)`; comando `/trust`; `CommandContext.workingDir`.
- **hermes:** `fleetWarnings(fleet)` y `blueprintWarnings(...)` exportados; `AGENT_BUSY` en `HermesErrorCode`. El hueco de un run se libera antes de escribir su estado final, para que quien acaba de ver `done` o `cancelled` no reciba `AGENT_BUSY`.

### Pendiente (no entra en esta versión)
SPEC-0009: C2 (el comodín `delegatesTo: ['*']`, menos urgente tras la confianza), C3b (presupuesto aplicado: exige un canal de coste en los conectores y en `agent-protocol`), C4 (el alias `model` → `provider` del frontmatter es deliberado, queda decidir si se separa) y C5 (tipo `Capability`, solo diseño). Y las decisiones de la auditoría: autenticación del HTTP de `mcp-server`, docker como default de `run_command`, `AgentServer` en `0.0.0.0`, `WebhookServer` con `secret` opcional.

## v0.33.1 (2026-10-24)

Auditoría de seguridad y robustez en cuatro lotes (#93, #94, #95, #96): 21 arreglos verificados contra el código, cada uno con sus tests. Rangos sin barrido: los parches caben en los `^` existentes; solo se actualizan los de plantillas (`orchestrator-agent ^0.6.0`), los de `create-bk-agent` (`mcp-server ^0.18.0`, `agent-web ^0.5.0`) y el peer de `hermes` sobre `agent-protocol` (`>=0.3.0 <0.5.0`).

| Paquete | Versión |
|---|---|
| `agent-core` | 0.33.1 |
| `agent-sandbox` | 0.1.4 |
| `agent-protocol` | 0.4.0 |
| `hermes` | 0.2.1 |
| `agent-coding` | 0.27.3 |
| `agent-enterprise` | 0.8.1 |
| `orchestrator-agent` | 0.6.0 |
| `curator-codex-agent` | 1.1.1 |
| `mcp-connectors` | 0.2.1 |
| `mcp-server` | 0.18.0 |
| `agent-web` | 0.5.0 |
| `create-bk-agent` | 0.23.1 |

`agent-providers`, `agent-otel`, `agent-testkit` y `aval-tools` no cambian.

**Orden de publicación (obligatorio):** core → sandbox → **agent-protocol** → **hermes** → coding → enterprise → orchestrator-agent → (curator-codex-agent, mcp-connectors, web, mcp-server) → create-bk-agent.
`hermes` 0.2.1 acepta `agent-protocol` 0.3 y 0.4 como peer; publicarlo antes que `agent-protocol` 0.4.0 no rompe nada, pero el orden evita instalaciones a medias.

### Cambios de comportamiento (léelos antes de actualizar)
- **orchestrator-agent 0.6.0:** el trigger HTTP escucha en `127.0.0.1` por defecto. Para exponerlo (un contenedor, la red) hace falta `ORCHESTRATOR_HTTP_HOST` **y** `ORCHESTRATOR_API_KEY`; un host no loopback sin clave no arranca el trigger. Los ejemplos de docker-compose de `docs/` ya lo incluyen. Además: `callLLM` tiene timeout (300 s, `ORCHESTRATOR_LLM_TIMEOUT_MS`) y la espera de subtareas vence a los 15 min (`ORCHESTRATOR_SUBTASK_TIMEOUT_MS`); dos aprobaciones solapadas del mismo gate ya no reanudan el plan dos veces (la segunda recibe 409).
- **agent-protocol 0.4.0:** `AgentClient.run()` y `runAndWait()` ya no repiten una capability tras un 5xx, un timeout o un corte (podía ejecutarse dos veces: un pago, un email). Solo reintentan un 429. `RunOptions.idempotent: true` recupera los reintentos para capabilities de solo lectura.
- **mcp-server 0.18.0:** el HTTP rechaza con 403 un `Host` u `Origin` no loopback (DNS rebinding). `resource-auth` deniega cuando ABAC no puede decidir (sin token, o `abac-service` caído); `BK_ABAC_FAIL_OPEN=1` lo permite en desarrollo. `code_index` solo acepta directorios dentro de `BK_CWD` o de `BK_INDEX_ROOTS`.
- **agent-web 0.5.0:** con un hook de auth que fija `req.user` (JwtAuth lo hace), `/sessions`, `DELETE /sessions/:id` y `/monitor` muestran a cada usuario solo sus sesiones; un token con el rol `admin` (`adminRole`) ve todas. Sin auth, nada cambia. CORS con varios orígenes devuelve el `Origin` de la petición en lugar de la lista unida.
- **mcp-connectors 0.2.1:** `fetchJson` no reintenta POST/PATCH ante un 5xx, un timeout o un corte (solo un 429). Las lecturas hechas con POST (Odoo `search`/`read`, HubSpot `/search`, Calendar `freeBusy`) lo declaran y siguen reintentando.
- **agent-core 0.33.1:** `ApprovalGate` juzga cada segmento del comando, no cómo empieza la línea: tras "approve all", instalar paquetes con `cd x && npm i y`, `sudo`, `-D`, `bash -c` o `python -m pip` vuelve a pedir aprobación. Skills y packs rechazan nombres con separadores, `:`, NUL, `.` o `..`.

### Arreglos
- **agent-coding 0.27.3:** `edit_file` ya no expande `$&`, `$1` ni `$$` en el texto nuevo (corrompía el archivo en silencio).
- **agent-core 0.33.1:** `FailureCatalog` no queda envenenado tras un fallo de escritura (perdía registros en silencio).
- **agent-sandbox 0.1.4:** `scrubEnv` también descarta variables `PAT` (`GH_PAT`, `GITHUB_PAT`) sin tocar `PATH` ni `PATHEXT`.
- **agent-enterprise 0.8.1:** `VectorStore` escribe de forma atómica; el frontmatter de `VaultWriter` escapa comillas y saltos de línea; el registro de `ComplianceGate` no puede salir de la bóveda con un `flowId` o `runId` como `../x`, y `VaultWriter` rechaza un `agentFolder` que resuelva fuera de ella.
- **orchestrator-agent 0.6.0:** `RunStore` escribe de forma atómica.
- **curator-codex-agent 1.1.1:** los adaptadores de LLM declaran su timeout (300 s, `timeoutMs`) en lugar de depender del default del SDK.

### Pendiente (decisiones de diseño, fuera de esta versión)
Autenticación del HTTP de `mcp-server` (el header `Authorization` ya es el JWT de ABAC), la allowlist de `run_command` y docker como default, `AgentServer` escuchando en `0.0.0.0`, `WebhookServer` con `secret` opcional.

## v0.33.0 (2026-10-23)

Migración a **zod 4** y a **openai 6**, y cierre de SPEC-0008 P4–P6 (control desde Hermes, aprovisionamiento, flows de otros agentes, plugins y presets). La migración cierra GHSA-mrhx-c7xc-m3w5 (`zod <4.6.6`), cuyo único parche es zod 4.6.6 (#90).

**Breaking:** los esquemas que se pasan a `defineTool` / `generateObject` deben ser de zod 4. `agent-core` ya no depende de `zod-to-json-schema` (devolvía `{}` con esquemas zod 4) y genera el JSON Schema con `z.toJSONSchema`. `agent-providers` pasa a `openai ^6`. Los proyectos que usen zod 3 junto a `agent-core` deben migrar: `z.record(x)` pasa a `z.record(z.string(), x)`, `invalid_type_error` pasa a `error` y los mensajes de error cambian (p. ej. "Invalid input: expected number").

| Paquete | Versión |
|---|---|
| `agent-core` | 0.33.0 |
| `agent-protocol` | 0.3.0 |
| `agent-providers` | 0.3.0 |
| `hermes` | 0.2.0 |
| `agent-enterprise` | 0.8.0 |
| `orchestrator-agent` | 0.5.0 |
| `curator-codex-agent` | 1.1.0 |
| `mcp-connectors` | 0.2.0 |
| `mcp-server` | 0.17.0 |
| `create-bk-agent` | 0.23.0 |
| `agent-coding` | 0.27.2 |
| `agent-sandbox` | 0.1.3 |
| `agent-otel` | 0.1.5 |
| `agent-testkit` | 0.1.4 |
| `agent-web` | 0.4.15 |
| `aval-tools` | 0.1.10 |

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (curator-codex-agent, mcp-connectors, testkit, web, mcp-server, aval-tools) → create-bk-agent.
`hermes` tiene como peers `agent-core >=0.33.0 <0.35.0` y `agent-protocol ^0.3.0`: publicarlo antes de sus peers rompe las instalaciones.

### Detalle
- **Hermes (SPEC-0008 P4–P6):** control desde Hermes (política, jobs y auditoría unificada), aprovisionamiento y carencias, flows de otros agentes (`agent-protocol`), plugins con `requires` y `grant` del operador, y presets (más el preset neutral `pipeline`).
- **zod 4:** `z.record` con clave explícita; `mcp-server` declara `zod` (antes lo usaba sin declararlo); las plantillas y `create-bk-agent` generan proyectos con `zod ^4.6.6`.
- **Seguridad:** `body-parser` 1.20.9 / 2.4.0 en el lockfile (GHSA-27r3-jxmh-p828, #91).
- **Sin verificar en vivo:** el generador de JSON Schema (`openapi-3.0`) y `openai` 6 contra un LLM real.

## v0.32.0 (2026-10-23)

Control de agentes desde fuera y primer Hermes (SPEC-0008 P1–P3; PRs #79, #81, #82, #83). Todo es aditivo y opt-in: sin `controlApiKey` el servidor se comporta como 1.0. Rangos 0.x barridos (`agent-core ^0.32.0`; peers `<0.33.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.32.0 |
| `agent-sandbox` | 0.1.2 |
| `agent-protocol` | 0.2.2 |
| `hermes` (nuevo) | 0.1.0 |
| `agent-coding` | 0.27.1 |
| `agent-enterprise` | 0.7.2 |
| `agent-providers` | 0.2.6 |
| `agent-otel` | 0.1.4 |
| `agent-testkit` | 0.1.3 |
| `agent-web` | 0.4.14 |
| `mcp-server` | 0.16.9 |
| `orchestrator-agent` | 0.4.6 |
| `aval-tools` | 0.1.9 |
| `create-bk-agent` | 0.22.11 |

`mcp-connectors` y `curator-codex-agent` no cambian.

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.2 tiene como peer `agent-core >=0.32.0 <0.33.0` (usa tipos nuevos: `PolicyControl`); `hermes` tiene como peers `agent-core >=0.31.0 <0.33.0` y `agent-protocol ^0.2.1`. Publicarlos antes de sus peers rompe las instalaciones.

### Detalle
- **core:** `createEngineControl(engine, { policy, jobs, approveWidening, onAudit })`: un handler de control con la forma de `ControlHandler` (`get/set_sandbox_policy`, `list_jobs`, `cancel_job`, `audit`). Estrechar una política es libre; ampliarla exige aprobación y falla cerrado sin aprobador (`APPROVAL_REQUIRED`); el techo del operador es un límite duro (`POLICY_WIDER_THAN_PARENT`); `expectedVersion` evita pisar cambios. `JobRegistry.listAll()` (nuevo método de la interfaz).
- **sandbox:** `isNarrowerOrEqual` / `checkNarrower` (un hijo nunca es más amplio que su padre) y `sandboxPolicyControl(policy, { ceiling })`.
- **agent-protocol:** protocolo 1.1 (compatible con 1.0): `POST /v1/agent/control`, `GET /v1/agent/runs`, `GET /v1/agent/audit`, `drain`/`resume` del servidor, `info` con `protocolMinor`, límites y flows. Cerrado por defecto: exige `controlApiKey`, distinta de `apiKey`. El cliente (`control`, `listRuns`, `audit`) no reintenta ni usa circuit breaker a propósito.
- **hermes (nuevo):** `fleet.yaml` validado (`bk-hermes validate`), registro de flota con salud periódica, conectores `in-process` y `protocol`, store de runs con reconciliación tras reinicio, herramientas `fleet_*`/`agent_*`, roles, aprobación que falla cerrado, guardrails sobre resultados y auditoría NDJSON.
- **Conocido:** cancelar un run en un `AgentServer` marca la tarea pero no aborta el handler del servidor.

## v0.31.0 (2026-10-23)

Herramientas de archivo detrás del sandbox (SPEC-0006 S3a; PR #76). Una ruta se juzga por **dónde apunta de verdad**: un symlink o junction dentro del workspace que apuntaba fuera permitía leer y escribir fuera, porque `resolveAndCheck` compara solo texto.
Es opt-in y compatible: sin `sandbox`, las herramientas se comportan como antes. Rangos 0.x barridos (`agent-core ^0.31.0`, `agent-coding ^0.27.0`; peers `<0.32.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.31.0 |
| `agent-sandbox` | 0.1.1 |
| `agent-coding` | 0.27.0 |
| `agent-enterprise` | 0.7.1 |
| `agent-providers` | 0.2.5 |
| `agent-otel` | 0.1.3 |
| `agent-testkit` | 0.1.2 |
| `agent-web` | 0.4.13 |
| `mcp-server` | 0.16.8 |
| `orchestrator-agent` | 0.4.5 |
| `aval-tools` | 0.1.8 |
| `create-bk-agent` | 0.22.10 |

`mcp-connectors` y `curator-codex-agent` no cambian: su rango `agent-enterprise ^0.7.0` cubre 0.7.1.

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.1 tiene como peer `agent-core >=0.31.0 <0.32.0` (usa tipos nuevos del contrato): publicarlo antes que core rompe las instalaciones.

### Detalle
- **core:** `SandboxRunner.authorizePath?` y tipos `SandboxPathRequest` / `SandboxPathVerdict`. El engine lo envuelve por llamada: denegaciones y escrituras permitidas salen por el transport y la auditoría de ese engine aunque el runner se comparta; las lecturas permitidas no se reportan.
- **sandbox:** `authorizePath` resuelve la ruta real (symlinks, junctions, enlaces colgantes y rutas aún inexistentes) y la compara con workspace + `roots` + directorios extra (memoria del agente). `read-only` rechaza escrituras; `danger-full-access` permite; una ruta que no se puede resolver se deniega. Exporta `realPathOf` e `isInsideDir`.
- **coding:** `write_file`, `edit_file`, `read_file`, `list_directory` y `search_files` consultan `ctx.sandbox.authorizePath` tras `resolveAndCheck`, que sigue siendo el suelo incluso en full access.

## v0.30.0 (2026-10-22)

Sandbox de ejecución (SPEC-0006 S1; PRs #73 y #74): confinamiento y permisos de lo que ejecutan los agentes, con política como datos que un plano de control puede fijar y consultar.
Es opt-in: sin `sandbox` configurado, `run_command` y el engine se comportan como antes (salvo la nota de la ruta heredada con docker). Rangos 0.x barridos (`agent-core ^0.30.0`, `agent-coding ^0.26.0`, `agent-enterprise ^0.7.0`; peers `<0.31.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.30.0 |
| `agent-sandbox` | 0.1.0 (nuevo) |
| `agent-coding` | 0.26.0 |
| `agent-enterprise` | 0.7.0 |
| `agent-providers` | 0.2.4 |
| `agent-otel` | 0.1.2 |
| `agent-testkit` | 0.1.1 |
| `agent-web` | 0.4.12 |
| `mcp-server` | 0.16.7 |
| `mcp-connectors` | 0.1.6 |
| `orchestrator-agent` | 0.4.4 |
| `aval-tools` | 0.1.7 |
| `curator-codex-agent` | 1.0.4 |
| `create-bk-agent` | 0.22.9 |

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-coding` depende **de forma dura** de `agent-sandbox` y este tiene como peer `agent-core >=0.30.0`: publicar coding antes que sandbox, o sandbox antes que core, rompe las instalaciones.
`agent-providers`, `agent-otel`, `agent-testkit`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-sandbox` (nuevo)
- **Modos** `read-only`, `workspace-write`, `danger-full-access` y red `none|allow`; presets `read-only`, `ask`, `auto-edit`, `full`.
- **Falla cerrado:** si el modo exigido no se puede imponer en este host, la llamada devuelve `SANDBOX_UNAVAILABLE` y no se ejecuta nada. El backend `none` (host) solo reclama `danger-full-access` con red abierta; `docker` reclama `read-only` y `workspace-write`.
- **Política como datos:** `SandboxPolicyConfig` JSON (preset, mode, approval, network, roots, reglas por agente/herramienta, env, writeTools, commandTools); `set()` validado que aplica a la siguiente llamada, `snapshot()`, `version`, `parsePolicyConfig()`.
- **Entorno depurado** (KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL) con `env.allow`; decisiones observables (`onDecision`) y auditoría NDJSON ordenada.
- Backend docker: workspace `:ro` y raíz de solo lectura en `read-only`, red `none` por defecto, sin capacidades, límites de memoria y procesos, **ejecución con el uid:gid del host en POSIX**.

### `@backendkit-labs/agent-core`
- Contrato `SandboxRunner` / `SandboxMode` / `SandboxOutcome` / `SandboxDecision`, `ExecutionContext.sandbox`, evento `sandbox` y `createBaseEngine({ sandbox })`; `engine.sandbox` para leer o cambiar la política en caliente.
- `authorizeTool` rechaza por nombre las herramientas de escritura en `read-only` antes del gate de aprobación; `approvalFor` sustituye la lista fija de herramientas que preguntan.
- **Fail-closed sin humano:** una herramienta que exige aprobación y no tiene `onToolApproval` se rechaza, incluso tras `disableToolApproval()`.
- Cada engine reporta solo las decisiones de sus propias llamadas aunque comparta el servicio con otros.

### `@backendkit-labs/agent-coding`
- `run_command` delega lanzamiento, terminación, timeout y captura al backend; las comprobaciones de comandos y los mensajes no cambian. `createCodingEngine({ sandbox: { preset, policy, backends, docker, auditLog } })` y `CODING_WRITE_TOOLS`.
- **Ruta heredada** (sin `sandbox`): `BK_RUN_COMMAND_SANDBOX` se traduce a la política equivalente (deprecado). Con `docker`, el contenedor corre ahora con el uid:gid del host en POSIX (antes root) y `BK_SANDBOX_NETWORK` distinto de `none` significa `bridge`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `sandbox`.

### Límites
Solo se confina lo que pasa por `ctx.sandbox.run`; una herramienta propia o MCP que lance procesos por su cuenta queda fuera. `read-only` rechaza por nombre solo las herramientas listadas como de escritura. Las herramientas de archivos siguen usando su propia comprobación de ruta hasta la siguiente entrega.

## v0.29.1 (2026-10-22)

Parche sobre la Ola 3a. Sin cambios de rangos: `^0.29.0` ya cubre 0.29.1.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.1 |
| `create-bk-agent` | 0.22.8 |

Orden de publicación: core → create-bk-agent.

- **`agent-core`:** un job cancelado (`job_kill`, `engine.abort()`) queda `cancelled` sin conservar como summary el error de su proceso muerto (antes `exit 1`) (#68).
- **`create-bk-agent`:** nuevo comando `npx create-bk-agent add testing`: instala `@backendkit-labs/agent-testkit`, jest y ts-jest como devDependencies, añade `jest.config.js`, el script `test` y un test de ejemplo sin clave de API; no sobrescribe archivos existentes (#71).
- **`agent-testkit` 0.1.0** (publicado aparte, paquete nuevo): dobles de prueba (`scriptedProvider`, `mockTransport`), servidor LLM mock compatible con OpenAI con fallos inyectables, grabación y reproducción de ejecuciones y aserciones sobre el sistema real (#69, #70).

## v0.29.0 (2026-10-22)

Ola 3a del SDK (SPEC-0002; PRs #63 a #66): herramientas con plazo y cancelación, recuperación ante desbordamiento de contexto, credenciales por referencia y jobs en segundo plano.
Todo es opt-in y aditivo salvo lo indicado. Rangos 0.x barridos (`agent-core ^0.29.0`, `agent-coding ^0.25.0`, `agent-enterprise ^0.6.0`; peers `<0.30.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.0 |
| `agent-providers` | 0.2.3 |
| `agent-coding` | 0.25.0 |
| `agent-enterprise` | 0.6.0 |
| `agent-otel` | 0.1.1 |
| `agent-web` | 0.4.11 |
| `mcp-server` | 0.16.6 |
| `mcp-connectors` | 0.1.5 |
| `orchestrator-agent` | 0.4.3 |
| `aval-tools` | 0.1.6 |
| `curator-codex-agent` | 1.0.3 |
| `create-bk-agent` | 0.22.7 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-providers`, `agent-otel`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-core`
- **Señal y plazo por herramienta:** `ExecutionContext.signal`; `timeoutMs` por herramienta y `toolTimeoutMs`/`toolTimeoutGraceMs` del engine. Al vencer o abortar, el modelo recibe `TOOL_TIMEOUT`/aborted y un resultado tardío se descarta. `tool_result` lleva `outcome` (`timeout` | `aborted`).
- **Reintento tras desbordamiento de contexto:** `isContextOverflowError`, `ContextManager.compact({ force, targetRatio })`, `noteOverflow()` y `ContextOptions.overflowRetry` (por defecto activo con `context`). Hasta 2 reintentos por ejecución; si el historial no se puede reducir se emite el error original.
- **Credenciales por referencia:** `AgentProfile.secrets` admite `{ env: "NOMBRE" }` (se resuelve en cada llamada) y `secretResolver` como respaldo; `secretLeakGuardrail` usa los valores resueltos. Los perfiles con valores literales siguen igual.
- **Jobs en segundo plano:** `createBaseEngine({ jobs })`, `JobRegistry`, herramientas `job_output`/`job_list`/`job_kill`, `ExecutionContext.jobs`, aviso de finalización al inicio de cada iteración y cancelación en `abort()`.

### `@backendkit-labs/agent-coding`
- `run_command`: respeta `ctx.signal` y mata el árbol de procesos (Windows: `taskkill /T /F`; POSIX: grupo de procesos propio); nuevo parámetro `background` cuando hay `jobs`.
- Opciones nuevas en `createCodingEngine`: `toolTimeoutMs`, `toolTimeoutGraceMs`, `jobs` (añade las herramientas `job_*` a los agentes con `run_command`) y `secretResolver`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `toolTimeoutMs`, `jobs` y `secretResolver`.

### `@backendkit-labs/agent-otel`
- Los spans `execute_tool` exponen el `outcome` de la herramienta como `bk.outcome`.

## v0.28.0 (2026-10-22)

Ola 2 del SDK: contexto por tokens con resumen, guardrails genéricos y trazas OpenTelemetry (PRs #59 y #60).
Todo es opt-in y aditivo: sin configurar `context`, `guardrails` ni un exportador de trazas el comportamiento no cambia.
Los rangos 0.x se barren (`agent-core ^0.28.0`, `agent-coding ^0.24.0`, `agent-enterprise ^0.5.0`) y los templates de `create-bk-agent` se actualizan.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.28.0 |
| `agent-providers` | 0.2.2 |
| `agent-coding` | 0.24.0 |
| `agent-enterprise` | 0.5.0 |
| `agent-otel` | 0.1.0 (nuevo) |
| `agent-web` | 0.4.10 |
| `mcp-server` | 0.16.5 |
| `mcp-connectors` | 0.1.4 |
| `orchestrator-agent` | 0.4.2 |
| `aval-tools` | 0.1.5 |
| `curator-codex-agent` | 1.0.2 |
| `create-bk-agent` | 0.22.6 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-web`, `mcp-server`, `mcp-connectors`, `aval-tools` y `curator-codex-agent` solo cambian rangos de dependencia/peer.

### Detalle

### `@backendkit-labs/agent-core` — contexto por tokens (`context`)
- Mantiene el historial bajo `context.maxTokens`: trunca resultados de tools viejos, resume los turnos más antiguos
  (el resumen nuevo extiende al anterior) y descarta como último recurso. Cortes en frontera de turno.
- Un resumidor que falla degrada a descartar con aviso; la compactación nunca detiene el run.
- El uso del resumidor se reporta como eventos `metrics` (lo ve el `CostTracker`). Estimador chars/4 calibrado con el
  `input_tokens` real del provider. Disponible también en `createCodingEngine` y `createEnterpriseSetup`.

### `@backendkit-labs/agent-core` — guardrails (`guardrails`, `guardrailOutputMode`)
- Fases `input`, `tool_call` (antes de la aprobación), `tool_result` y `output`, sobre el agente principal y todos los sub-agentes.
- Decisiones allow / redact / block, `failMode` cerrado por defecto, `dryRun`.
- Ready-made: `piiGuardrail`, `secretLeakGuardrail`, `promptInjectionGuardrail` (heurístico), `maxLengthGuardrail`,
  `denyListGuardrail`, `llmJudgeGuardrail`. Un bloqueo en `tool_call` borra los argumentos del historial.
- Salida `after` (corrige el historial; el evento trae `replacement`) o `buffer` (nada sin revisar se muestra).
- Evento `guardrail`, entradas `guardrail:<fase>:<nombre>` en `auditLog` y `MetricsSnapshot.guardrails`.
- Coding y enterprise **no** activan guardrails por defecto.

### `@backendkit-labs/agent-core` / `agent-providers` — spans de llamadas
- `llm_call` (modelo, proveedor, tokens, caché, coste, `purpose`) y `tool_call` bajo el `agent_block`, con inicio y fin reales.
- Los eventos `metrics` y `tool_result` ganan `agent_id`, `started_at` y `duration_ms` (opcionales); `metrics` también
  `provider`, `model` y `purpose`. Quien compare esos eventos con igualdad exacta debe pasar a una comparación parcial.
- `LLMProvider.modelId?` (lo implementan `OpenAICompatibleProvider` y `AnthropicProvider`).

### `@backendkit-labs/agent-otel` 0.1.0 (nuevo)
- `otlpHttpSpanExporter`: OTLP/JSON por HTTP sin SDK. `otelApiSpanExporter`: vía `@opentelemetry/api` (retiene el trace hasta
  que termina `agent.run`). Convenciones semánticas GenAI; nunca exporta prompts, respuestas ni argumentos de tools.
- Sin probar contra Jaeger/Langfuse reales. No está en `publish.yml`: publicación manual.

## v0.27.1 (2026-10-22)

Correcciones halladas probando con DeepSeek. Los rangos `^0.27.0`, `^0.2.0` y `^0.23.0` ya cubren estas versiones: sin barrido ni cambio en `create-bk-agent`.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.1 |
| `agent-providers` | 0.2.1 |
| `agent-coding` | 0.23.1 |

### Detalle

### `@backendkit-labs/agent-core` / `agent-providers` / `agent-coding` — correcciones halladas probando con DeepSeek

- **`metrics` lleva `cost_usd`.** El `ObservabilityManager` calculaba el costo pero el evento que llegaba
  al transporte seguía sin él, así que ninguna interfaz podía mostrarlo. Ahora, con un `costTracker` con
  precios, el evento `metrics` reenviado incluye el `cost_usd` de esa llamada (tokens de caché incluidos).
  Un `cost_usd` que ya traiga el provider se respeta, y sin precios el evento no cambia.
- **DeepSeek V4 y `toolChoice` forzado.** V4 piensa por defecto y responde 400 a un `toolChoice`
  `'required'` o por nombre en ese modo. `DeepSeekProvider` envía ahora `thinking: disabled` en esas
  llamadas (si no fijaste `thinking` tú). Opción nueva `disableThinkingForForcedTools` en
  `OpenAICompatibleProvider` (apagada por defecto: no todos los endpoints aceptan el campo `thinking`;
  encendida en el preset de DeepSeek y para el provider `deepseek` de `createCodingEngine`).

### `examples/` — refactor con las novedades de 0.27

Los ejemplos dependen ahora de los paquetes **publicados** (`agent-core ^0.27.0`, `agent-coding ^0.23.0`,
`agent-providers ^0.2.0`…) en vez de rutas `file:` que ya no resolvían dentro del monorepo.
- `git-agent`: `createBaseEngine` + `agent-providers` (se borra su copia del provider y la dependencia
  `openai`); presupuesto por ejecución con `abortOnBudget`; modo solo lectura (`GIT_AGENT_READONLY=1`);
  `/report` con salida estructurada (`engine.generateObject`); la terminal muestra uso, avisos del
  framework y tope de presupuesto; `npm run smoke` (prueba real contra un repo temporal).
  Sus herramientas git ya no pasan por un shell: usan `execFile` con argumentos (nada de lo que elija el
  modelo se interpreta como sintaxis de shell), rechazan refs que empiezan por `-`, no se cuelgan pidiendo
  credenciales y devuelven también lo que git imprime por stderr (checkout, merge, push). `npm run check`
  las prueba sin LLM.
- `vault-pilot`: su `DeepSeekProvider` pasa a ser un adaptador fino sobre `agent-providers`.
- `code-explainer` y `git-analyst`: tope de gasto opcional por llamada (`AGENT_BUDGET_USD` + precios).
- `coding-assistant`: tope de gasto opcional, `maxParallelTools: 4`, muestra uso de caché y tope de
  presupuesto; corrige tipos desfasados (`IterationMode`, `mcpAdd`) que ya no compilaban contra core.
- Sin cambios (no usan un motor de agentes): `pg-dev-server`, `marketing-co`, `workflow.mcp-agents`.
  `finance-managment` (NestJS con motor propio) queda fuera de este cambio.

## v0.27.0 (2026-10-21)

Cierra la Ola 1 del SPEC-0001: salida estructurada (ADR-0003) y caché de prompt y razonamiento de
Anthropic (ADR-0004).

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.0 |
| `agent-providers` | 0.2.0 |
| `agent-coding` | 0.23.0 |
| `orchestrator-agent` | 0.4.1 |
| `agent-enterprise` | 0.4.3 |
| `agent-web` | 0.4.9 |
| `mcp-server` | 0.16.4 |
| `aval-tools` | 0.1.4 |
| `create-bk-agent` | 0.22.5 |

`agent-providers` 0.2.0 requiere `agent-core` `>=0.27.0 <0.29.0`. `orchestrator-agent`,
`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` / `agent-coding` / `agent-providers`; los templates pasan a `agent-core ^0.27.0` y
`agent-coding ^0.23.0`. `maxParallelTools` sigue en 1 por defecto.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — salida estructurada (ADR-0003)

`generateObject(provider, prompt, zodSchema, opts?)` (nuevo, en `agent-core`) pide al modelo un
objeto que cumpla el esquema, lo valida con zod y lo devuelve tipado. Una respuesta inválida se
reintenta **una vez** diciéndole al modelo qué estaba mal; si vuelve a fallar lanza
`StructuredOutputError` (con `raw` e `issues`). Los fallos del provider se relanzan tal cual.
`engine.generateObject(prompt, schema, { agentId?, retries? })` usa el provider del agente y emite
el uso de tokens como eventos `metrics` (sin tocar el historial). También `generateObjectWith`
para clientes que no son un `LLMProvider`, y `zodToParameters` (el helper de esquemas que usaba
`defineTool`, ahora exportado).

Contrato (compatible hacia atrás, todo opcional): `LLMProvider.chat(..., options?: ChatOptions)`
con `responseFormat` y `toolChoice`, y `LLMProvider.capabilities.structuredOutput`
(`'native' | 'json_object' | 'none'`). Un provider que no conoce `options` sigue funcionando: la
validación zod siempre se aplica, y si el provider no impone el esquema éste se añade al prompt.

Mapeo por provider:
- `OpenAICompatibleProvider`: `response_format: json_schema` (`structuredOutput: 'native'`, por
  defecto). El modo estricto se relaja solo si el esquema tiene campos opcionales u objetos que
  admiten propiedades extra (OpenAI respondería 400). `toolChoice` se traduce a `tool_choice`.
- `DeepSeekProvider` y `OllamaProvider`: `json_object` (el esquema viaja en el prompt). Ollama
  admite `structuredOutput: 'native'` si tu servidor soporta `json_schema`.
- `AnthropicProvider`: `output_config.format` con el esquema (`structuredOutput: 'native'`) o, como
  respaldo explícito, una herramienta `respond` forzada (`structuredOutput: 'tool'`; no se puede
  combinar con `thinking`). `toolChoice` se traduce a `tool_choice`.
- `createCodingEngine`: el provider `deepseek` usa `json_object` por defecto (no admite
  `json_schema`); `structuredOutput` es configurable en cada provider.

`intent-detector` deja de extraer la acción con una regex: usa `generateObjectWith` con un enum de
acciones. Una respuesta no válida sigue acabando en `unknown`. `LLMChatClient.chat` y
`adaptProviderToLLMClient` propagan las opciones. El planner de `orchestrator-agent` y los curadores
migran a `generateObject` en cambios posteriores.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — caché de prompt y razonamiento extendido de Anthropic (ADR-0004)

`AnthropicProvider` (y `AnthropicConfig` de `createCodingEngine`) gana, todo opt-in:
- `cache: 'none' | 'system' | 'system+tools' | 'auto'` (default `'none'`: la petición es idéntica a
  la anterior) y `cacheTtl: '5m' | '1h'`. Con caché, el system prompt se envía como bloques con
  `cache_control` en el último; `system+tools` marca también la última herramienta y `auto` añade
  un punto móvil en el último mensaje (útil en bucles de herramientas).
- `thinking: { budgetTokens }` (entero >= 1024 y < `maxTokens`; si no, error claro al crear el
  provider). Con thinking se omite `temperature`. Los bloques `thinking`/`redacted_thinking` con su
  firma se guardan en `LLMMessage.raw` y se reenvían intactos en el turno siguiente.

Contrato de `agent-core`:
- `LLMMessage.raw?: unknown` (payload opaco del provider; `HistoryManager` lo persiste).
  `OpenAICompatibleProvider` lo descarta al enviar.
- `LLMStreamCallbacks.onMetrics(input, output, usage?)` con `usage = { cacheReadTokens, cacheWriteTokens }`,
  y `onReasoning?(delta)`. El evento `metrics` gana `cache_read_tokens` y `cache_write_tokens`
  opcionales (visibles en la terminal de `coding`).
- `CostTracker` suma lectura y escritura de caché con `cacheReadPricePerMToken` /
  `cacheWritePricePerMToken` (por defecto 0,1x y 1,25x del precio de entrada; con TTL de 1 hora
  la escritura cuesta ~2x: configúralo). `MODEL_PRICING` incluye esos precios para los modelos
  Anthropic que ya listaba, **calculados con los multiplicadores y no contrastados con la tarifa
  vigente**: revísalos antes de confiar en el costo.

No se emite evento de razonamiento al transporte en esta ola (queda `onReasoning`).

## v0.26.0 (2026-10-21)

| Paquete | Versión |
|---|---|
| `agent-core` | 0.26.0 |
| `agent-providers` | 0.1.0 (nuevo) |
| `agent-coding` | 0.22.0 |
| `orchestrator-agent` | 0.4.0 |
| `agent-enterprise` | 0.4.2 |
| `agent-web` | 0.4.8 |
| `mcp-server` | 0.16.3 |
| `aval-tools` | 0.1.3 |
| `create-bk-agent` | 0.22.4 |

`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` (y los templates de `create-bk-agent` pasan a `agent-core ^0.26.0`, `agent-coding
^0.22.0`, `orchestrator-agent ^0.4.0`).

### `@backendkit-labs/agent-providers` 0.1.0 (nuevo) — una sola implementación de providers (ADR-0005)

Paquete nuevo con `BaseStreamingProvider`, `OpenAICompatibleProvider`, `AnthropicProvider` y los
presets `OllamaProvider` y `DeepSeekProvider`. `agent-coding` los re-exporta con los mismos
nombres y `orchestrator-agent` los consume (su `provider.ts` queda como adaptador de la config
snake_case). Reintentos con `@backendkit-labs/retry`: 429, 5xx y errores de red; nunca tras
emitir contenido ni tras un aborto. Cliente SDK inyectable (`client`) y primera suite de pruebas
de providers.

Cambios de comportamiento a tener en cuenta:
- `maxAttempts` explícito; `maxRetries` queda como alias obsoleto con el mismo significado de
  antes (intentos totales; en Ollama cuenta reintentos, 2 = 3 intentos).
- **Ollama:** ahora pide `include_usage` (antes no reportaba tokens, así que el presupuesto no
  veía sus llamadas) y también reintenta 429.
- **DeepSeek:** `maxRetries` ya no se descarta.
- **orchestrator-agent:** ahora respeta `model` y `signal` (se puede abortar); sigue sin enviar
  `max_tokens` y conserva temperatura 1 para modelos "reasoner".
- `createCodingEngine`: `OpenAICompatibleConfig` expone `thinking`.
- `agent-coding` ya no depende de `openai` ni de `@anthropic-ai/sdk` (los trae `agent-providers`).
- `agent-providers` declara `agent-core` como peer (`>=0.25.0 <0.27.0`); `orchestrator-agent`
  sube su rango de `agent-core` a `^0.25.0`.

Pendiente de este ADR: bump y publicación (providers → coding → orchestrator-agent) y actualizar
los templates cuando `agent-providers` esté en npm.

### `@backendkit-labs/agent-core` 0.26.0 / `@backendkit-labs/agent-coding` 0.22.0 — aborto automático por presupuesto (ADR-0002)

`abortOnBudget` (default `false`) en `createBaseEngine` y `createCodingEngine`; este último expone
además `observability`. Con él, al superar `costTracker.budget` el motor llama a `engine.abort()`,
emite el evento nuevo `budget_exceeded` (con `BudgetUsage`) y luego invoca tu `onBudgetExceeded`.
La llamada que cruza el límite termina (y se paga), pero su respuesta se descarta. Los
sub-agentes (`ask_agent`) también se detienen. Si hay `budget` sin precios, o con `perDay`, el
motor emite un aviso `system` de nivel `warn` al crearse (el gasto diario no se persiste).

**Cambio de comportamiento:** `onBudgetExceeded` se disparaba en cada evento de métricas
una vez superado el límite, y el límite diario quedaba oculto si el de ejecución también se
superaba. Ahora se dispara **una vez por límite y por ejecución** (`perDay`: una vez por día) y se
reportan ambos si se superan a la vez. El costo que entrega el provider (`cost_usd`) ahora se
acumula entre llamadas en `getRunCost()` / `getDayCost()`. `AgentEvent` gana `budget_exceeded`:
revisa los `switch` exhaustivos propios.

## v0.25.0 (2026-10-21)

### `@backendkit-labs/agent-core` 0.25.0 / `@backendkit-labs/agent-coding` 0.21.0 — ejecución paralela de tool calls (ADR-0001)

`ToolDefinition.concurrencySafe` (opt-in, default `false`) y `maxParallelTools` en `AgentEngine`,
`createBaseEngine` y `createCodingEngine` (default `1`: comportamiento idéntico al anterior).
Con `maxParallelTools > 1`, las tools seguras consecutivas de un turno corren en paralelo; una
tool no segura es una barrera. Resultados y eventos conservan el orden de las llamadas y
`onToolApproval` se invoca en serie. Marcadas seguras: `read_file`, `list_directory`,
`search_files`, `list_audits`, `get_latest_audit`, `memory_recall`, `memory_search_knowledge`.
Tools MCP: solo con `MCPServerConfig.trustAnnotations: true` y `readOnlyHint`.

### `@backendkit-labs/agent-core` — `createBaseEngine` reenvía los callbacks de aprobación e iteración (corrección)

`createBaseEngine` no declaraba ni reenviaba `onToolApproval`, `onIterationLimit`, `onStep` ni
`iterationMode` a `AgentEngine`. `createCodingEngine` los pasa con `spread` condicional, que
TypeScript no revisa por propiedades sobrantes, así que se descartaban en silencio: **la
aprobación de herramientas de escritura nunca se activaba** (un callback que devolvía `'reject'`
no impedía que `write_file` se ejecutara) y los callbacks de iteración no se llamaban.

Ahora `BaseEngineOptions` declara los cuatro y se pasan al motor. Quien use `createCodingEngine`
con `onToolApproval` empezará a ver las confirmaciones que antes no aparecían. Detalle en
`docs/specs/SPEC-0001-agent-core-ola-1.md` §2.

## v0.24.0 (2026-08-07)

### `@backendkit-labs/agent-core` — credenciales por agente

`AgentProfile.secrets` (nuevo, opcional): credenciales propias del agente, inyectadas en
`ExecutionContext.secrets` en cada llamada a herramienta. Antes de esto, una herramienta que
necesitara una clave externa sólo podía leerla de una variable de entorno compartida por todo
el proceso — cualquier agente con esa herramienta tenía la misma clave que todos los demás. Con
`secrets`, la clave vive en el perfil de cada agente y una herramienta la lee de `ctx.secrets`,
no del entorno.

Cambio aditivo: campo opcional en `AgentProfile` y en `ExecutionContext`, propagado en
`buildContext()` con el mismo patrón condicional que ya usa `blockedCommands`. No afecta a
ningún agente existente que no lo declare.

```typescript
const profile: AgentProfile = {
    // ...
    allowedTools: ['pay', 'check_payment'],
    secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
};
```

### `@backendkit-labs/aval-tools` (paquete nuevo)

Herramientas `pay` y `check_payment` para que un agente gaste dinero a través de una instancia
de [AVAL](https://github.com/BackendKit-labs/aval) — presupuesto previo, decisión antes del
gasto, registro encadenado. `pay` pide un techo de gasto y devuelve el resultado como texto
(pagado, retenido o denegado); `check_payment` consulta el estado de un gasto retenido en una
invocación posterior, sin que la sesión del agente tenga que quedarse esperando a que una
persona lo apruebe.

Usa `secrets` de arriba para la credencial: cada agente lleva su propia clave de AVAL, nunca
una compartida.

## v0.23.0 (2026-06-11)

### `@backendkit-labs/agent-web` — `MonitorBus`

Nuevo subsistema de observabilidad en tiempo real sobre todas las sesiones activas del servidor.

#### `MonitorBus`

Fan-out de eventos a observadores WebSocket read-only. Un servidor puede tener N monitores conectados simultáneamente sin impacto en las sesiones de chat.

```typescript
import { MonitorBus } from '@backendkit-labs/agent-web';
```

**Protocolo (server → monitor):**

```typescript
// Al conectar: lista de sesiones ya abiertas
{ type: 'monitor_hello', sessionIds: string[] }

// Ciclo de vida de sesiones
{ type: 'monitor_session_open',  sessionId: string }
{ type: 'monitor_session_close', sessionId: string }

// Input del usuario (antes de que el engine procese)
{ sessionId: string, type: 'run_input', content: string }

// Todos los AgentEvents de esa sesión
{ sessionId: string, type: 'token' | 'tool_call' | 'done' | ... }
```

El `MonitorBus` se crea automáticamente en `AgentServer` y se conecta al `SessionManager`. No requiere configuración adicional.

**Endpoint:** `WS /monitor` — read-only, no acepta input del cliente.

**`/health`** ahora incluye `monitors: number` — cantidad de observadores conectados.

---

### `@backendkit-labs/agent-web-ui` — template `kanban`

Template de monitoreo enterprise: visualiza la actividad de todos los agentes en tiempo real como un tablero kanban.

#### Layout

Secciones apiladas verticalmente. Cada sección es una columna del flujo:

```
┌─────────────────────────────────────────────┐
│ ● PENDIENTE  (n)                             │
│  [Card: mensaje del usuario]                 │
├─────────────────────────────────────────────┤
│ ● EN PROCESO  (n)                            │
│  [Card: agente trabajando + tool badges]     │
├─────────────────────────────────────────────┤
│ ● ESPERANDO APROBACIÓN  (n)                  │
├─────────────────────────────────────────────┤
│ ● COMPLETADO  (n)                            │
│  [Card: finalizado + tiempo + tokens]        │
└─────────────────────────────────────────────┘
```

#### Mapeo de eventos → columnas

| Evento | Transición |
|---|---|
| `run_input` | Nueva card en **Pendiente** |
| `block_start` | → **En Proceso** (actualiza agente activo) |
| `tool_call` | Badge animado (spinner) sobre la card activa |
| `tool_result` | Badge → verde (ok) / rojo (error) |
| `done` / `ready` | → **Completado** |
| `error` | → **Completado** (sección roja) |
| `monitor_session_close` con run activo | → **Completado** (error: desconexión) |

#### `useKanbanMonitor` hook

```typescript
const { runs, status, activeSessions, connect, disconnect, clearDone } =
  useKanbanMonitor({ url: 'ws://localhost:3000/monitor' });
```

`runs: KanbanRun[]` — historial completo de runs. Cada run tiene `sessionId`, `title` (primeros 80 chars del input), `column`, `agentId/Name/Icon`, `toolCalls[]`, `tokens`, `startedAt`, `completedAt`.

#### Navegación integrada

`NavTabs` — tabs **Chat / Monitor** en el header de ambos templates. Hash router sin dependencias externas:

- `http://localhost:5173/` → Chat
- `http://localhost:5173/#kanban` → Monitor

---

## v0.22.0 (2026-06-10)

### `@backendkit-labs/agent-web` 0.1.0 — nuevo paquete

Capa HTTP/WebSocket que envuelve `AgentEngine` y lo expone al browser.

#### `WebSocketTransport`

Implementa la interfaz `Transport` de `agent-core` sobre un WebSocket de `@fastify/websocket`. Traduce `AgentEvent` a frames JSON. Maneja reconexiones y cierre limpio.

```typescript
// El engine recibe un WebSocketTransport en lugar de CallbackTransport
const transport = new WebSocketTransport(socket);
const engine = new AgentEngine({ transport, ... });
```

#### `SessionManager`

Gestiona N sesiones concurrentes. Una `AgentEngine` instance por sesión. Sweep automático de sesiones idle (default: 30 min). Límite configurable de sesiones simultáneas (default: 100).

#### `AgentServer`

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({
    port: 3000,
    engineFactory: (sessionId, transport) => new AgentEngine({ transport, ... }),
    auth: async (req, reply) => { /* JWT / API key / OIDC — hook pluggable */ },
    cors: '*',
    maxSessions: 100,
    maxIdleMs: 30 * 60 * 1000,
});

await server.start();
```

**Rutas:**

| Ruta | Descripción |
|---|---|
| `WS /chat` | Conectar sesión. Enviar `{ type: 'input', content }` / `{ type: 'abort' }` |
| `GET /health` | Estado del servidor y número de sesiones activas |
| `GET /sessions` | Lista de sesiones con timestamps |
| `DELETE /sessions/:id` | Cerrar sesión específica |

**Protocolo WebSocket (client → server):**

```json
{ "type": "input",  "content": "¿Cuál es la política de vacaciones?" }
{ "type": "abort" }
```

El servidor devuelve `AgentEvent` JSON frames: `token`, `tool_call`, `tool_result`, `agent_switch`, `done`, `error`, etc. — mismos eventos que `CallbackTransport`.

**Cliente HTML de prueba:** `client/index.html` — chat funcional vanilla JS, sin dependencias, sirve como referencia de implementación del protocolo.

---

### `@backendkit-labs/agent-web-ui` 0.1.0 — nuevo paquete

Template React para el template `chat` del scaffold enterprise.

**Stack:** React 18 + Vite + Tailwind CSS v4 + shadcn/ui + TypeScript

#### `useAgentSession` hook

```typescript
const {
    messages,      // ChatMessage[] — historial completo
    status,        // 'disconnected' | 'connecting' | 'connected'
    isRunning,     // true mientras el engine procesa
    activeAgent,   // { id, name, icon } del agente activo
    connect,
    disconnect,
    sendMessage,
    abort,
    clearMessages,
} = useAgentSession({ url: 'ws://localhost:3000/chat' });
```

Maneja el estado completo del stream: acumula tokens en el mensaje activo, actualiza badges de tool calls en tiempo real, detecta cambios de agente.

#### Componentes

| Componente | Descripción |
|---|---|
| `ChatWindow` | Área de scroll con auto-scroll al último mensaje |
| `MessageBubble` | Burbujas user/assistant con Markdown renderizado, cursor de streaming |
| `ToolCallBadge` | Badge animado: spinner → verde (ok) / rojo (error) |
| `InputBar` | Textarea auto-resize, Enter para enviar, botón Stop durante streaming |

#### `App.tsx` — template chat completo

- Header con badge del agente activo y estado de conexión
- Barra de URL colapsable para cambiar el servidor sin recompilar
- Dark theme por defecto (variables CSS de shadcn)
- `VITE_AGENT_SERVER_URL` env var para configurar el servidor en build

---

### Pilot enterprise — web server

`pilot/src/web-server.ts` — servidor de prueba que conecta el pilot vault con el browser:

```bash
PORT=4001 npm run web   # desde /pilot
# → abre http://localhost:5173 (Vite dev server)
```

Validado end-to-end: browser conecta por WebSocket, agente busca en vault con RAG, responde en streaming token a token, badges de tool call se animan en vivo.

---

## v0.21.0 (2026-06-10)

### `@backendkit-labs/agent-core` 0.20.2 → 0.21.0

#### Engine decomposition — god object eliminado

`AgentEngine` pasó de ~1350 a ~895 líneas. Cuatro módulos extraídos con responsabilidad única:

| Módulo | Responsabilidad |
|---|---|
| `HistoryManager` | Historial de mensajes: push, save, load, sanitize, trim |
| `AuditLogger` | Escritura de registros de auditoría en disco |
| `MCPRegistrar` | Estado MCP, init, registro de agentes/tools/triggers, routing |
| `ApprovalGate` | Decisión de aprobación de tool calls (3 branches → `check()`) |

#### Tests — red de integración del core

10 escenarios de integración nuevos sobre `AgentEngine` + `DelegationBus`:

| Test | Qué valida |
|---|---|
| `abort()` a mitad de ejecución | `sanitizeMessages` elimina chain incompleto; no hay 400 en el siguiente `run()` |
| 3 `ask_agent` en paralelo | `runParallel` ejecuta concurrente; resultados mapeados al `tool_call_id` correcto |
| Delegación anidada | `depth > 0` bypasea el bulkhead; no hay starvation con 6 slots |
| Dos `run()` concurrentes | Mutex serializa; historial no se corrompe |
| Historial con chain partido cargado de disco | Save + load round-trip produce historial válido |
| `toolTriggers` MCP sin permiso | Auth + approval aplican igual que para tools directas |
| Tool rechazada por `onToolApproval` | Mensajes de error correctos; audit con `success: false` |
| `maxIterations` en sub-agentes | Config respetada (no hardcoded 30) |
| Eventos paralelos por agente | Cada bloque `block_start…block_end` es contiguo por `agent_id` |
| `loadAgents` concurrente | Promise cache: una sola carga; ambos callers esperan |

Suite total: **294 tests** (293 en rama `refactor/engine-quality` + 1 fix post-merge).

#### QA flow — cobertura

`QAService` y `qa-orchestrator` ahora cubiertos:
- `countCodeLines`: 5 tests
- `evaluateReview`: 10 tests (todos los paths + patrones específicos + tiebreaker)
- `extractFindings`: 7 tests (bullet, numerado, severidades, fallback)
- `activateQaEngineerIfNeeded`: 7 tests
- `processQaEngineerResponse`: 6 tests

Fix: `'issues found'` eliminado de `REJECTION_PATTERNS` — era substring de `'no issues found'` y causaba falso positivo.

#### Fase 3 — strings al LLM unificados en inglés

Cero español en strings que entran al contexto del LLM:
- `AgentEngine`: headers de orquestación traducidos
- `qa-orchestrator`: prompt de activación del QA engineer traducido
- `QAService`: `APPROVAL_PATTERNS` / `REJECTION_PATTERNS` reorganizados (inglés primero, español como fallback para respuestas mixtas); system prompts, mensajes de usuario y headers de secciones traducidos
- `LessonsMemoGenerator`: headers de documento, secciones, tabla, checklist y todas las recomendaciones por `failureType` traducidos

#### Fase 4 — clasificación de subsistemas

Matriz de estado publicada en el README raíz. Tres niveles:

| Estado | Significado |
|---|---|
| **core** | Requerido para la historia enterprise — revisión completa ante cambios |
| **stable** | Funciona y se mantiene; no se expande durante el piloto |
| **experimental** | Congelado — `qa`, `reflection`, `agent-memory`, `observability`, `triggers` |

Regla durante el piloto: sin features nuevas en subsistemas `experimental`.

---

### `@backendkit-labs/agent-enterprise` 0.2.0 → 0.3.0

#### Nuevo export: `SimpleEmbedder`

```ts
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
```

TF-IDF con feature hashing (256 dims, djb2), sin dependencias externas, sin Ollama.
Ideal para desarrollo, CI y pilotos donde no hay GPU disponible.
Para producción usar `OllamaEmbedder` con `nomic-embed-text`.

---

### Pilot enterprise (`pilot/`) — no publicado

REPL interactivo que valida la historia enterprise de punta a punta:
- Vault compartido como fuente única de verdad (`pilot/vault/`)
- 6 notas seed: decisiones de arquitectura, patrones, lecciones, guía de arranque
- `npm run repl` — conversación libre con agente consultant + analyst
- `npm run smoke` — verifica indexado RAG + búsqueda + llamada LLM end-to-end
- `dotenv` — carga `.env` automáticamente al arrancar
- `SimpleEmbedder` — sin Ollama requerido para el piloto

Ciclo validado: humano documenta → LLM busca via RAG → agente responde con contexto real del negocio → agente escribe de vuelta → conocimiento disponible en el próximo turno.

---

### Docs

- `proyecto-agentes-web.md`: Principio rector 2 — vault como fuente única de verdad; §2.1 con diagrama del ciclo de aprendizaje colectivo y tabla agente genérico vs enterprise
- READMEs de paquetes: status header en `core`, `enterprise`, `coding`, `mcp-server`, `create-bk-agent`

---

## v0.15.0 (2026-06-04)

### Breaking changes — package rename

All packages now use the `@backendkit-labs` npm scope:

| Old | New |
|-----|-----|
| `@bk/agent-core` | `@backendkit-labs/agent-core` |
| `@bk/agent-coding` | `@backendkit-labs/agent-coding` |
| `@bk/mcp-server` | `@backendkit-labs/mcp-server` |

Migration:

```bash
npm uninstall @bk/agent-core @bk/agent-coding @bk/mcp-server
npm install @backendkit-labs/agent-core @backendkit-labs/agent-coding
```

Replace all imports:

```ts
// Before
import { ... } from '@bk/agent-core';
// After
import { ... } from '@backendkit-labs/agent-core';
```

### New

- `create-bk-agent` — interactive CLI scaffolder (`npx create-bk-agent my-project`)
- 5 starter templates: `coding`, `domain-agent`, `autonomous`, `mcp-server`, `minimal`
- `AgentEngine.updateWorkingDir(newCwd)` — live workspace switch without engine restart
- `/skills create` — scaffold a new skill file locally
- `/skills generate` — LLM-generate a skill from a description
- `/skills reload` — hot-reload skills without restarting
- `/skills uninstall` and `/skills update` — full skill lifecycle management
- `AgentEngine.callLLM(prompt)` — direct single-turn LLM call for slash commands

### Fixed

- `advanceRequiredGates`: only advances gates the task actually requires
- QA gate no longer records a false GO when no qa-engineer agent exists
- Policy engine used `architecture-agent`/`security-agent` IDs that did not match registered profiles — corrected to `architecture`/`security`
- `hasPassedGate`: replaced linear index comparison with FSM-semantics checks
- `computeKeywordScores`: capped at 15 to match confidence normalization denominator
- Workspace `add-app` now syncs `settings.cwd` when the new project becomes active

---

## v0.14.0 (2026-05-30)

- Skills hot-reload: `AgentEngine.reloadSkills()` resets YAML layer on next `run()`
- Orchestration: respect `requiresX` flags in gate advancement
- `matchesKeyword` deduplicated into `orchestration/keyword-match.ts`
- `AgentEngine.callLLM()` for raw single-turn LLM access from slash commands
- QA gate never auto-GO without a real reviewer