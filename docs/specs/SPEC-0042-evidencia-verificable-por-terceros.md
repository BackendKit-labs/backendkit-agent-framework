# SPEC-0042: evidencia verificable por terceros (puntos de control firmados, anclaje y caducidad de aprobaciones)

**Fecha:** 2026-11-21
**Estado:** Borrador. Sin fases hechas.
**Origen:** un análisis externo pegado por el autor (2026-11-21) sobre qué puede aprender BackendKit de Steward: proxy de credenciales, autorización ligada al payload y de un solo uso, y evidencia de auditoría verificable sin confiar en el operador. Esta spec compara esas tres ideas con el código y propone lo que corresponde al SDK. Lo que dice el análisis sobre normas (ISO 42001, AI Act) **no se verificó** y no debe usarse como afirmación en la web.
**Depende de:** `HashChainAuditSink` y `verifyAuditChain` (`governance/audit.ts`), `ApprovalStore` y `runApproved`, SPEC-0041 (autoridad del aprobador).
**Tipo de cambio:** aditivo. Sin paquete nuevo salvo decisión del autor (§6).
**Objetivo:** que un tercero que no confía en el operador pueda comprobar el registro de auditoría de un agente, y que una aprobación no pueda ejecutarse indefinidamente tarde.

## 1. De dónde se parte

Verificado el 2026-11-21 en `packages/core/src` y en el repo de Steward (`../steward/packages`):

**Credenciales.** El modelo no ve las claves: `resolveSecrets` las entrega a la **tool** en cada llamada (variable de entorno o `secretResolver`), y se leen al momento, así que una rotación aplica sin reiniciar. La tool las recibe **dentro del proceso**: una tool con un fallo, un `run_command` o un servidor MCP externo las tiene al alcance. Un proxy fuera del proceso que inyecte la credencial solo si la política pasa sería más fuerte.

**Aprobación ligada a la llamada.** Ya está en gran parte: la aprobación se guarda con la llamada exacta, `runApproved` ejecuta esos argumentos, `markExecuted` es atómico y de una sola vez, la política se evalúa de nuevo antes de ejecutar y la auditoría guarda el SHA-256 de los argumentos. Faltan dos cosas: (a) no hay **caducidad** (no hay `ttl` ni expiración en `approval-store.ts`), y (b) la garantía existe dentro del motor pero **no viaja** a un ejecutor externo que pueda comprobarla.

**Prueba de aprobación.** Steward ya la tiene: `erp-port/src/approval-proof.ts` define una prueba firmada con Ed25519 (formato tipo JWS compacto, solo con `node:crypto`), de un solo uso, con `approverId`, nivel, audiencia, agente, capacidad, caso y caducidad, y con rotación de claves en `governance`. Es decir, ese punto del análisis **ya está resuelto en Steward**, no en el SDK.

Cómo la emite Hermes (revisado el 2026-11-21 en `apps/hermes-server/src`), porque condiciona cualquier gancho del SDK:

- **No usa `ApprovalStore` ni `runApproved` del SDK.** Hermes tiene su propio almacén de aprobaciones y su propio lanzamiento, con su propio gobierno (`policy-engine`, `governance`).
- **Firma al lanzar, no al resolver.** La prueba se emite justo después de registrar la decisión y justo antes de ejecutar, con caducidad desde ese momento (3600 s por defecto). Además emite pruebas de **base `policy`** para los niveles 0 y 1, sin que nadie apruebe nada.
- **El firmante es una interfaz, no una clave.** `ApprovalSigner { kid, sign(claims, audience) }` puede ser asíncrono y fallar; la clave puede estar en un archivo, un KMS o un HSM. Si falla, la aprobación **no se pierde** (se reintenta) y no se emite prueba.
- **La prueba viaja en la entrada de la tool**, no en el contexto: un manifiesto vincula un campo de la entrada a `proof` y sobrescribe lo que el modelo haya escrito ahí.

**Auditoría.** `HashChainAuditSink` encadena con SHA-256 y admite un secreto para un HMAC por entrada; `verifyAuditChain` verifica sin conexión y el `head` se puede guardar fuera para anclar el log. El código de Steward usa el mismo esquema y tampoco tiene firma asimétrica. **Faltan:** (a) una firma asimétrica, porque con HMAC el verificador necesita el secreto y por tanto no es un tercero; (b) un anclaje de tiempo (RFC 3161); (c) un paquete exportable que se pueda verificar solo con la clave pública. Es la laguna real.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Se firma cada entrada? | **No.** Se firman **puntos de control**: `{ seq, head, at, kid }` firmado con Ed25519, cada N entradas o a demanda. Firmar cada línea sube el costo y no aporta más que firmar el `head` que ya las encadena. |
| D2 | ¿Qué claves y dónde? | La clave privada la da el operador (`node:crypto`, sin dependencias nuevas). El SDK no guarda claves. Un `kid` identifica la clave y se admite rotación. |
| D3 | ¿Qué es el paquete de evidencia? | Una carpeta o archivo con el registro, los puntos de control, las claves públicas y un verificador. `verifyBundle` lo comprueba **sin conexión y sin el secreto del operador**. |
| D4 | ¿Basta la firma para "no confiar en el operador"? | **No, y la spec lo dice.** Quien tiene la clave privada puede reescribir el registro entero y volver a firmarlo. Lo que lo impide es un **ancla fuera de su alcance**: un sello de tiempo RFC 3161 de una autoridad externa, o publicar el `head` en un sitio que el operador no controla. Sin ancla, la evidencia es "detectable por quien conserva un `head` anterior", no probatoria. |
| D4b | ¿RFC 3161 dentro del SDK? | **No en `agent-core`** (decidido el 2026-11-21): verificar un sello exige ASN.1 y CMS, es decir una dependencia pesada o un parser a mano, para algo que usa una minoría. El núcleo define la interfaz `TimestampAnchor` y un **ancla simple** que publica el `head` donde el operador elija (archivo, URL, commit en otro repositorio). RFC 3161 se escribe cuando un cliente real lo pida, como **paquete aparte y previa consulta**, o en Steward si solo lo piden sus clientes. |
| D5 | ¿Caducidad de aprobaciones? | `expiresAt` opcional en la solicitud y comprobación en `runApproved`. Una aprobación caducada no se ejecuta, y queda anotado. Por defecto sin caducidad (aditivo). |
| D6 | ¿Prueba de aprobación para ejecutores externos? | **Se queda en Steward** (decidido el 2026-11-21). El formato mezcla lo genérico con el modelo de Steward (niveles, empresa, `caseIds`). Y revisado Hermes, **no usa el motor del SDK para aprobar ni lanzar**, así que un gancho en el SDK no le serviría hoy. Se **aplaza**: no se añade nada al SDK hasta que haya un segundo consumidor. Si llega, el diseño es el de §5-bis, no un `approvalProver` al resolver. |
| D7 | ¿Proxy de credenciales? | El SDK define solo la **interfaz** de un *credential broker* (pedir una credencial para una llamada ya autorizada, con un alcance y un uso). La implementación que intercepta la llamada fuera del proceso es de plataforma, y por tanto de Steward. |

## 3. Lo que esto no promete

- No hace "cumplimiento" de ninguna norma. Aporta evidencia técnica que un auditor puede evaluar.
- La firma y el anclaje **no** impiden que el operador borre registros antes del primer punto de control o del primer ancla. Lo que cubren es lo que queda entre dos anclas.
- Un paquete sin ancla es "tamper-evident", no probatorio. El verificador lo indica en su resultado.

## 4. Fases

| Fase | Qué | Criterio de hecho |
|---|---|---|
| **F0** | Pruebas que fijan lo de hoy: una aprobación guardada se ejecuta pasado cualquier tiempo; con HMAC el verificador necesita el secreto. | Pasan sobre el código actual. |
| **F1** | Puntos de control firmados con Ed25519 (D1, D2) y `verifyBundle` sin conexión (D3). | Un paquete verifica solo con la clave pública. Editar, quitar o reordenar una línea, o cambiar un punto de control, lo rompe. Una clave rotada sigue verificando lo anterior. |
| **F2** | Interfaz `TimestampAnchor` y el ancla simple que publica el `head` (D4, D4b). RFC 3161 queda fuera hasta que haya demanda. | Un paquete con ancla verifica que el `head` coincide con lo publicado. Sin ancla, `verifyBundle` lo dice. |
| **F3** | `expiresAt` en aprobaciones (D5). | Una aprobación caducada no se ejecuta ni por el aprobador inmediato ni por `runApproved`. Sin `expiresAt`, nada cambia. |
| **F4** | Interfaz del *credential broker* (D7) y documentación. | Un ejemplo con un broker de prueba. La implementación real queda fuera del SDK. |

## 4-bis. Si algún día el SDK lleva una prueba de ejecución

Lo aprendido de Hermes, para no diseñarlo mal:

1. **Se emite al ejecutar**, no al resolver la aprobación: una prueba emitida al resolver caduca antes de usarse, o se usa fuera de la ventana pensada.
2. **Antes de consumir la aprobación.** `runApproved` hoy llama a `markExecuted` y luego ejecuta. Si la emisión de la prueba fallara después, la aprobación quedaría gastada sin que nada se ejecute. Hermes lo evita reintentando. En el SDK, la emisión iría **antes** de `markExecuted`, o `markExecuted` se haría después de emitir.
3. **Cubre también lo permitido por política**, no solo lo aprobado: el ejecutor externo quiere una prueba en ambos casos.
4. **Interfaz de emisor, no clave:** `issue(llamada, decisión)` asíncrono y que puede fallar, para que la clave pueda estar en un KMS. Es la forma del `ApprovalSigner` de Steward.
5. **Entrega a la tool** por el contexto (`ctx`), y la tool decide en qué campo de la llamada externa la pone. El modelo nunca la escribe.

## 5. Riesgos

- **Gestión de claves:** el SDK no puede hacerla bien por el operador. La documentación debe dejar claro que una clave comprometida invalida la evidencia posterior a la fecha de compromiso.
- **Promesa de más:** llamar "inmutable" o "probatorio" a algo que sin ancla no lo es. El verificador y la web usan los términos de §3.
- **Dos implementaciones del mismo esquema:** el SDK y Steward ya comparten el esquema de cadena. Esta spec debe cuidar que no diverjan.

## 6. Decisiones abiertas

Cerradas el 2026-11-21: la prueba de aprobación se queda en Steward (D6) y RFC 3161 no va en `agent-core` (D4b).

1. ¿Frecuencia por defecto de los puntos de control (cada N entradas o por tiempo)?
2. ¿Qué autoridades de sellado se documentan como ejemplo, sin recomendar una en concreto?
3. ¿Qué segundo consumidor justificaría llevar la prueba de ejecución al SDK (§4-bis)?
