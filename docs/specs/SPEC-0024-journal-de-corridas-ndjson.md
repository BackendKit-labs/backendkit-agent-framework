# SPEC-0024: journal de corridas en un archivo por corrida, con cadena de integridad (evaluación del diseño de Steward)

**Fecha:** 2026-11-17
**Estado:** **Aceptada** (el usuario aceptó D1-D6 con las propuestas, 2026-11-17). **F1 y F2 implementadas**; **F4 hecha (2026-11-18): `FileRunJournal` se elimina** en vez de deprecarlo (decisión del usuario: el framework está en desarrollo; ver §8). F3 (vallado en Redis) **descartado**: preventivo, sin un caso que lo pida. Con la implementación el spec dice lo que se hizo, no solo lo propuesto.
**Origen:** el banco `audit-desk` (`agent-framework-examples/audit-desk`) halló que `FileRunJournal` falla con un fan-out ancho (#214). Al compararlo con el journal de Steward (`steward/apps/hermes-server/src/file-journal.ts`, SPEC-0009 §6 del repo de Steward) resultó que Steward resuelve **por diseño** lo que aquí se arregló con parches, y es más rápido.
**Relacionado:** [SPEC-0023](SPEC-0023-flujos-declarativos.md) (`RunJournal`, F3), [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) (un contrato por concepto: Steward y el SDK tienen hoy dos journals de corridas).
**Tipo de cambio:** aditivo (una clase nueva, opt-in). No toca `FileRunJournal` ni `MemoryRunJournal` ni la interfaz `RunJournal`.

## 1. Qué se evalúa

Llevar al SDK el diseño del journal de Steward: **un archivo `<runId>.ndjson` por corrida**, de solo añadir, con una **cadena de integridad** entre líneas, `fsync` en cada entrada, tratamiento de la línea cortada, detección de corrupción y un **único escritor** por corrida con un bloqueo que sabe si su dueño sigue vivo.

## 2. Evidencia

### 2a. Medición (2026-11-17, Windows 11, NTFS, 400 eventos de ~300 bytes; prototipo del diseño de Steward contra `FileRunJournal`)

| | ms/evento (escribir) |
|---|---|
| ndjson + cadena HMAC + `fsync` (Steward) | **3,0** |
| ndjson + cadena HMAC, sin `fsync` | 2,0 |
| ndjson, sin cadena, sin `fsync` | 1,8 |
| `FileRunJournal` hoy (un hard link por evento) | **9,1** |

| | leer la corrida de 400 eventos |
|---|---|
| ndjson, leer y **verificar la cadena** | **9,5 ms** |
| `FileRunJournal.get` | **555 ms** |

Es decir: el diseño de Steward escribe ~3 veces más rápido y lee ~58 veces más rápido, **con** `fsync` y cadena. El `fsync` cuesta ~1 ms por evento; la cadena, ~0,2 ms. El prototipo no incluye el bloqueo ni la comprobación de tamaño (un `stat` por escritura). `FileRunJournal` además hace `readdir` del directorio entero en cada `append` y lee un archivo por evento, así que su coste crece con el número de eventos y de corridas.

### 2b. Qué tiene el de Steward que el del SDK no

| Propiedad | Steward | SDK hoy (`FileRunJournal`) |
|---|---|---|
| Un archivo por corrida | sí | un archivo por evento y por claim |
| Integridad | cadena por línea (HMAC con la clave del nodo, o SHA-256 simple): quitar, cambiar o insertar una línea es `JournalCorrupt` | ninguna |
| Durabilidad | una escritura `O_APPEND` + `fsync` por entrada; `append` vuelve cuando está en disco | sin `fsync` |
| Corte a mitad de escritura | la última línea sin `\n` nunca fue confirmada: se ignora y se recorta antes de la siguiente escritura | el evento se publica de forma atómica (hard link), así que no queda a medias; queda un `.tmp` huérfano |
| Una corrupción no esconde las demás | `list` la aparta y la registra en `problems` | n/a |
| Permisos | `0o600` | los del proceso |
| Escritor | uno por corrida; **detecta** otro escritor (tamaño del archivo distinto del esperado) y entrada `n` distinta de la esperada, y se niega | admite escritores concurrentes; solo el `claim` los separa |
| Bloqueo | `<runId>.lock` con `{pid, token}`; el dueño **muerto** se releva al instante; el token distingue un contenedor reiniciado con el mismo pid | `claim` con TTL y renovación (#211): hay que **esperar el TTL** tras una caída (3 s en `audit-desk`) |
| Contención | no existe (un escritor) | la tuvo (#214) |

## 3. Qué traer y qué no

**Traer (genérico, sin dependencias):** formato ndjson con cadena (clave opcional), `fsync`, línea cortada, detección de corrupción con `problems`, permisos `0o600`, escritor único con **vallado** (la comprobación de tamaño y de `n`), bloqueo por pid + token, caché de `list` por tamaño.

**No traer tal cual:**
- **El bloqueo solo por pid** vale en un host. El SDK también sirve a varios hosts (Redis), donde no hay pid. Para archivos compartidos entre hosts (NFS) no se promete nada: se documenta y se usa Redis.
- **Los tipos de entrada de Steward** (`created`, `JournalEntry`, `replay`) son de su runner. Aquí la línea envuelve el `JournalEvent` que el SDK ya tiene (`begin`, `step`, `update`) y se pliega con `foldEvents`: la interfaz `RunJournal` no cambia.
- **La dependencia en una clave de nodo:** en el SDK la clave es una opción (`key?: Buffer`).

## 4. Diseño propuesto: `NdjsonRunJournal` (nombre provisional)

```ts
new NdjsonRunJournal(dir, { key?: Buffer, fsync?: 'always' | 'never' /* def. always */ })  // implements RunJournal
```

- **Línea:** `{ n, event, mac }\n` con `mac = HMAC-SHA256(key, prev + '\n' + {n,event})` (SHA-256 simple sin clave: detecta daño accidental, no manipulación deliberada). `begin` es `n = 0`.
- **`begin`:** `open(path, 'wx', 0o600)` (falla si existe), escribe, `fsync`, sincroniza el directorio donde el sistema lo permita.
- **`step` / `update`:** los de una corrida se **serializan dentro del proceso** (`runFlow` llama a `step` en paralelo) y el journal asigna `n`. Cada uno: comprobar que el tamaño del archivo es el esperado, `O_APPEND` + `fsync`. Tamaño distinto = otro escritor: `JournalConflict`.
- **Primera escritura de un proceso:** leer y verificar el archivo, recortar una última línea sin terminar, quedarse con la cola `{n, mac, size}`.
- **`claim(runId, owner, ttlMs)`:** archivo `<runId>.lock` con `{owner, pid, token}`. Se releva si el dueño **ya no existe** (pid muerto, o mismo pid con otro token); si sigue vivo se niega, **aunque haya pasado el TTL**. Renovar por el mismo dueño no hace nada. `ttlMs` se ignora y `claimRenewMs` deja de hacer falta con este journal.
- **`get` / `list`:** leer, verificar la cadena y plegar con `foldEvents`. `list` guarda por corrida `{tamaño, estado}` y no relee un archivo que no creció; una corrupción se aparta en `problems`. `get` de una corrida corrupta lanza `JournalCorrupt`.
- **Vallado en `runFlow`:** un `JournalConflict` al escribir significa que la corrida ya no es nuestra: se trata como el claim perdido de #211 (parar, no escribir más, lanzar `FlowClaimError`). Cierra un hueco que hoy existe: tras perder el claim, un paso en vuelo que termina todavía escribe en el journal.

## 5. Lo que mejora y lo que cuesta

| Mejora | Coste |
|---|---|
| ~3× más rápido al escribir y ~58× al leer, con `fsync` y cadena (§2a) | un formato nuevo: una clase opt-in, `FileRunJournal` se queda |
| Recuperación inmediata tras una caída (sin esperar el TTL) | un proceso **colgado pero vivo** retiene la corrida hasta que alguien lo mate (lo mismo acepta Steward) |
| Daño o edición del archivo detectados; un corte a mitad de escritura no deja basura | el `fsync` por evento (~1 ms) |
| Sin contención por diseño; un segundo escritor se **detecta**, no solo se excluye con el claim | ya no se admiten dos instancias escribiendo la misma corrida: los tests de #214 que lo hacen pasan a esperar `JournalConflict` |
| Vallado: una corrida perdida no escribe más | `runFlow` aprende a tratar `JournalConflict` |

**Límites, declarados:** la cadena **no detecta que se trunque el final** del archivo (quitar las últimas líneas deja una cadena válida): hace falta un ancla externa (el último `mac` guardado aparte), que queda fuera. La clave opcional protege de quien edita el archivo pero no de quien también lee la clave. El journal sigue guardando las salidas de los pasos tal cual: es tan sensible como los datos, y `0o600` es lo único que se añade.

## 6. Fases

| Fase | Qué | Tamaño |
|---|---|---|
| **F1** | `NdjsonRunJournal`: formato, cadena, `fsync`, serialización por corrida, línea cortada, `JournalCorrupt`, `problems`, `list` con caché, `0o600`. Pruebas: cortar una línea a medias, editar/quitar/insertar una línea, clave equivocada, 60 pasos en paralelo, `list` con una corrida corrupta. | ~250 líneas + ~300 de pruebas |
| **F2** | `claim` por pid + token y vallado en `runFlow` (`JournalConflict` → `FlowClaimError`). Pruebas con **procesos reales y kill duro** (como `audit-desk`): el dueño muerto se releva sin esperar, el vivo se respeta. | ~120 + ~150 |
| **F3** (opcional) | Vallado en `RedisRunJournal`: el script `APPEND` recibe la longitud esperada y se niega si otro escribió. Sin cadena de integridad (Redis es la frontera de confianza). | ~40 + pruebas contra Redis real |
| **F4** | Documentación, el ejemplo `audit-desk` con la opción, y decidir si `FileRunJournal` queda `@deprecated`. | |

## 7. Y Steward

Hoy hay **dos journals de corridas**: `FileWorkflowJournal` (Steward, con su `WorkflowJournal`) y el `RunJournal` del SDK. Es la duplicación que SPEC-0017 quiere evitar. Esta propuesta **no** obliga a Steward a nada: lo prudente es que el journal del SDK iguale al suyo y, más adelante, Steward decida si adopta el del SDK (tendría que expresar sus entradas como `JournalEvent`) o conserva el suyo. El ejemplo `audit-desk` no depende de esa decisión.

## 8. Decisiones (aceptadas el 2026-11-17 con las propuestas de la columna derecha)

| # | Decisión | Propuesta |
|---|---|---|
| D1 | ¿Clase nueva o cambiar `FileRunJournal` en su sitio? | **Clase nueva** (cambia el formato y la semántica del claim); `FileRunJournal` sigue y se evalúa deprecarlo tras una versión. |
| D2 | Semántica del bloqueo: ¿solo dueño muerto (Steward) o también relevar a un vivo cuyo TTL venció? | **Solo dueño muerto.** Relevar a un vivo sin vallado completo puede cortar una escritura en curso; con F2 el vallado lo haría seguro, pero no hay caso que lo pida. |
| D3 | Clave de integridad | **Opcional.** Sin clave, SHA-256 simple (daño accidental); con clave, HMAC. |
| D4 | `fsync` por defecto | **`always`** (cuesta ~1 ms/evento); `never` para pruebas y discos lentos. |
| D5 | ¿Vallado en Redis (F3)? | Sí, aparte y solo si se usa Redis con varios orquestadores. |
| D6 | Steward: ¿adoptar el journal del SDK? | Decisión suya, **después** de F2. |

## 9. Lo implementado (F1 y F2)

`NdjsonRunJournal` en `packages/core/src/flow/ndjson-journal.ts`, con `JournalCorrupt` y `JournalConflict` (en `journal.ts`) y el vallado en `runFlow` (un `JournalConflict` en cualquier escritura se trata como el claim perdido). Pruebas: el contrato compartido de los tres journals de core (el de expiración por TTL no aplica a este), 31 pruebas propias (cadena rota de seis maneras, el límite de la cola, clave y sin clave, línea cortada, `list` con una corrida corrupta, vallado, el bloqueo con un dueño muerto, vivo, con el pid reutilizado y con un archivo ilegible, y `runFlow` con 60 pasos en paralelo, con reanudación tras un dueño muerto y con vallado), y en `audit-desk` (`npm run ndjson:check`) un orquestador real **matado con SIGKILL** a mitad de la auditoría: el claim queda libre **10-18 ms** después del kill (con Redis había que esperar el TTL de 3 s), otro proceso termina el audit sin perder un hallazgo y sin repetir los pasos hechos (solo los que estaban en vuelo). Tres corridas seguidas en verde.

## 10. Veredicto

**Merece la pena.** El diseño de Steward no es solo "más seguro": es más rápido, no tiene el problema de contención que costó #214 y recupera una corrida caída al instante. Su límite es que asume **un host**, y se declara. Recomiendo F1 y F2 como un cambio (una clase nueva, opt-in); F3 solo cuando haya un caso.

## 8. F4: `FileRunJournal` se elimina (2026-11-18)

Se pensó en deprecarlo, pero el usuario decidió **quitarlo**: el framework está en desarrollo y publicar algo ya deprecado no aporta. Es una ruptura de `agent-core` (en 0.x, minor): se quita la clase, sus exportaciones y sus pruebas propias (`file-journal-contention`; el resto lo cubre la batería de contrato y las pruebas de `NdjsonRunJournal`: carrera por el claim, escrituras concurrentes, `begin` duplicado, ids no seguros, persistencia entre objetos, fan-out ancho). `examples/flows` usa `NdjsonRunJournal`. 214 pruebas del flujo pasan.

**Lo que se pierde, dicho:** las corridas que dejó un `FileRunJournal` no se leen con `NdjsonRunJournal` (otro formato), y el claim por TTL sobre un directorio compartido entre contenedores (el de `NdjsonRunJournal` usa el pid). Para varios hosts o contenedores sigue `RedisRunJournal` o `PostgresRunJournal`. Documentado en el CHANGELOG (sin publicar) y en la guía "Migrate between versions".

**Fuera de este cambio:** `audit-desk` (repo de ejemplos) puede seguir usando `FileRunJournal` y dejará de compilar al actualizar `agent-core`; se cambia ahí. **F3 descartado.**
