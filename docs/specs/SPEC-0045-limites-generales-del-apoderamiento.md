# SPEC-0045: límites generales del apoderamiento (más allá del importe)

**Fecha:** 2026-11-24
**Estado:** **Borrador, sin revisar.** No se toca ningún tipo publicado hasta que el autor lo apruebe.
**Origen:** observación del autor (2026-11-24): «hablas solo si la lógica fuera dinero; el agente puede tener diferentes usos, lógicas de negocio». Es cierta: el apoderamiento expresa **qué acciones** y **sobre qué** para cualquier negocio, pero su «hasta cuánto» (`limits`) solo sabe medir **un importe con moneda**.
**Depende de:** SPEC-0043 (apoderamiento), SPEC-0044 (identidad), `packages/core/src/governance/mandate.ts`, `packages/mandates` (verificador de referencia y kit de adaptadores).
**Tipo de cambio:** aditivo en `core` (`Mandate.limits` y una opción de `mandatePolicy`) y una versión nueva del perfil de la credencial en `agent-mandates`.
**Objetivo:** que un apoderamiento pueda limitar **cualquier magnitud medible de una llamada** (filas, kilos, destinatarios, tamaño de un archivo), no solo dinero, sin que el framework conozca ninguna lógica de negocio.

## 1. De dónde se parte

Verificado el 2026-11-24:

- **`Mandate`** tiene `actions` (qué tools), `resources` (sobre qué) y `limits?: { amount?: { max, currency? } }`. `mandateCovers` solo sabe comparar ese importe, y exige que la política sepa medirlo (`amountOf`): si el apoderamiento limita el importe y la llamada no dice cuánto gasta, **no cubre nada**.
- **`resources`** es genérico (ids, rutas, cuentas) y lo lee la aplicación con `resourceOf`. Cubre «sobre qué» para cualquier dominio.
- **El kit de adaptadores** (`checkPowers`) **rechaza** un poder que lleve una restricción que no sabe aplicar (`maxPerDay`, `validBetween`): ignorarla concedería más de lo que el emisor quiso. Es la regla correcta.
- **El verificador de referencia hacía lo contrario hasta 0.1.3.** Se comprobó ejecutando: una credencial con `limits: { amount, rows: { max: 5 } }` se aceptaba y el apoderamiento resultante tenía **solo** el importe; la restricción `rows` desaparecía en silencio. Lo mismo con claves desconocidas del claim `mandate` o dentro de `amount`. Eso es un fallo **abierto**, ya corregido en `agent-mandates` 0.1.4 (rechaza lo que no conoce), y es la razón por la que este documento propone una **versión nueva del perfil** y no ampliar el actual en silencio (D6).
- **Lo que hoy se hace en su lugar** es una `ToolPolicy` del operador: cualquier regla de negocio cabe ahí, pero **no va firmada, ni la emite quien tiene autoridad, ni queda en la credencial**.

**Lo que falta:** un apoderamiento que diga, firmado, «hasta 5 filas por operación», «hasta 100 acciones de este tipo por llamada», con la misma garantía que hoy tiene el importe.

## 2. Decisiones propuestas

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo se generaliza «hasta cuánto»? | Una **lista de medidas**: `limits.measures: Array<{ name, max, unit? }>`. `amount` sigue como está (es una medida con moneda y existe en credenciales ya emitidas). Cada medida es **un máximo por operación** sobre una magnitud que la aplicación sabe leer de la llamada. |
| D2 | ¿Quién sabe medir? | La aplicación, igual que hoy con `amountOf`: `mandatePolicy({ measureOf: { rows: (args) => ({ value: args.ids.length }) } })`. El framework no conoce ninguna magnitud. Un nombre que el apoderamiento limita y que la política **no sabe medir** hace que la llamada **quede fuera del alcance** (falla cerrado), como el importe. |
| D3 | ¿Qué pasa al superar un máximo? | Lo mismo que hoy con el importe: «fuera del alcance». Con `outOfScope: 'ask'` (por defecto) pregunta a una persona, y ahí aplica `outOfScopeApprover`: esta especificación no cambia eso. |
| D4 | ¿Y la unidad? | Opcional. Si el apoderamiento la dice, la llamada debe medir en esa unidad (como la moneda hoy): una unidad distinta es «fuera del alcance». |
| D5 | ¿Contadores por periodo («50 correos al día») y ventanas de tiempo? | **Fuera de esta especificación.** Un contador necesita **estado** (cuánto se ha usado) y el framework no guarda ninguno en el apoderamiento. Se propone una especificación aparte con una interfaz `UsageStore`, y mientras tanto se usa una política del operador. Una ventana de horario **no** necesita estado (depende solo del reloj), pero exige decidir zona horaria y festivos; se deja como pregunta abierta (§5). |
| D6 | ¿Cómo viaja en la credencial sin que un verificador antiguo la lea mal? | Con **`vct` nuevo** (`urn:backendkit:mandate:2`) para toda credencial que lleve `measures`. Un verificador que no conoce `vct: 2` la **rechaza** (ya comprueba el `vct`), así que no puede aceptarla ignorando las medidas. Las credenciales con solo `amount` pueden seguir con `vct: 1`. |
| D7 | ¿Nombres de las medidas? | Texto corto y estable (`^[a-z][a-z0-9_]{0,31}$`), únicos dentro del apoderamiento. `amount` queda reservado para el importe y no se repite como medida. |
| D8 | ¿Qué queda en la auditoría? | El evento ya guarda el hash de la credencial. Se propone **no** copiar las medidas al evento (la credencial las contiene), salvo que se pida lo contrario (§5, pregunta 4). |
| D9 | ¿Los adaptadores de un proveedor? | `Power.max` pasa a poder acompañarse de `Power.measures` en el kit (`checkPowers` valida nombre, máximo y unidad). Una restricción que el adaptador no traduce **sigue** rechazándose. |
| D10 | ¿Cambia algo para quien no usa medidas? | Nada. Es aditivo: `limits.amount`, `amountOf` y las credenciales actuales funcionan igual. |

## 3. Lo que no hace

- **No evalúa lógica de negocio.** No sabe qué es una fila ni un destinatario: el operador dice cómo medir y el apoderamiento dice el máximo.
- **No cuenta usos.** Cada medida es por llamada. Un tope diario es la especificación de estado (D5).
- **No decide condiciones sobre el contenido** («sin datos personales»). Eso son guardarraíles o política, no un límite medible.
- **No sustituye a la política.** Las reglas propias del negocio siguen siendo código del operador; esto solo mete en el poder firmado las que son un **máximo numérico por llamada**.

## 4. Fases

| Fase | Contenido | Hecha cuando |
|---|---|---|
| **F0** | Esta especificación, revisada por el autor. Y la pregunta A3 del cuestionario al equipo de Identidad: si su credencial real admite restricciones más allá de verbo, objeto e importe. | Revisada; preguntas de §5 cerradas. |
| **F1** | En `core`: `Mandate.limits.measures`, la opción `measureOf` de `mandatePolicy`, `mandateCovers` que las comprueba (máximo, unidad, medida desconocida). | Una llamada que supera una medida, una con otra unidad, una con una medida que la política no sabe leer, un valor negativo o `NaN`, y un nombre repetido: todas **fuera del alcance** con motivo; una dentro, cubierta; `amount` sin cambios. |
| **F2** | En `agent-mandates`: perfil `vct: 2` (el verificador lo acepta con `measures`, `issueMandate` lo emite), `Power.measures` en el kit y el adaptador del ejemplo. | Un verificador con `vct: 1` **rechaza** una credencial con medidas; una con `vct: 2` y una medida desconocida para el perfil se rechaza con su nombre. |
| **F3** | Documentación (con ejemplos de **varios dominios**, no solo pagos) y el ejemplo `portfolio-advisor` con una medida que no es dinero (acciones por orden). | El ejemplo corre con la medida y sus pruebas fallan si se quita. |

## 5. Preguntas abiertas

1. ¿`measures` como lista (`[{ name, max }]`) o como objeto (`{ rows: { max } }`)? Propuesta: **lista**, porque conserva el orden y permite duplicados detectables; el objeto es más corto de escribir.
2. ¿Una ventana de horario entra en esta especificación o va con los contadores? Es sin estado, pero necesita zona horaria y calendario.
3. ¿Un `UsageStore` para contadores por periodo? Es una decisión de arquitectura (¿quién guarda el estado: el motor, el operador, el proveedor de identidad?) y merece su propia especificación.
4. ¿Debe el evento de auditoría copiar las medidas que se aplicaron? Ayuda a leer el registro sin la credencial, pero engorda cada evento.
5. ¿Qué dice el equipo de Identidad? Si su credencial real ya trae restricciones propias (A3 del cuestionario), el diseño de las medidas debe poder traducirlas sin pérdida; si no, esta generalización puede ir sola.

## 6. Registro

- **2026-11-24, borrador.** Escrita tras comprobar que el verificador de referencia ignoraba en silencio las restricciones desconocidas (corregido en `agent-mandates` 0.1.4) y que el tipo `Mandate` solo sabe medir un importe.
