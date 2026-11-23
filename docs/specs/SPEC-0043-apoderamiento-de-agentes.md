# SPEC-0043: apoderamiento de agentes (poder delegado, verificable y con límites)

**Fecha:** 2026-11-22
**Estado:** F1 y F2 implementadas (2026-11-22), ver §7; **F4 escrita como borrador sin revisar** (2026-11-23); F3 (adaptador de DALION) **bloqueada** hasta tener el formato de la credencial (§6). El paquete `agent-mandates` 0.1.0 está publicado en npm.
**Origen:** una nota del equipo de Identidad (2026-11-22) sobre DALION, su solución de identidad digital compatible con eIDAS 2: los agentes trabajan con una identidad digital propia y una **credencial de apoderamiento** que dice para quién trabajan (el humano), qué pueden hacer, sobre qué y hasta qué importe, sin ir a pedir permiso al humano cada vez. El autor quiere que los agentes del framework sean compatibles con los estándares de la industria, también cuando no se usa Steward.
**Depende de:** `Principal` y la política (`governance/policy.ts`, `governance/types.ts`), el directorio de aprobadores y el cuatro ojos (SPEC-0041), el broker de credenciales y la evidencia verificable (SPEC-0042).
**Tipo de cambio:** aditivo en `core` (una interfaz y un ayudante de política) y **un paquete opcional nuevo**, decidido por el autor (2026-11-22). Nada se publica sin consulta.
**Objetivo:** que el límite de lo que un agente puede hacer solo venga de un **poder verificable** emitido por quien tiene autoridad, y no de código del agente; y que cualquier tercero pueda comprobar bajo qué poder actuó.

## 1. De dónde se parte

Verificado el 2026-11-22 en `packages/core/src/governance`:

- **Quién actúa y para quién.** `Principal` lleva `agentId`, `chain` (la cadena de delegación entre agentes), `userId` (la persona de parte de quien actúa), `tenantId` y `sessionId`. Hoy `userId` viene de `identity` en las opciones del motor: lo da la aplicación, el framework no lo autentica.
- **Dónde se decide qué se permite.** `ToolPolicy.decide(principal, call)` ve los argumentos reales de la llamada y devuelve `allow`, `ask` o `deny`. "Hasta 1000 €" ya se escribe ahí, **pero como código del agente**, no como un poder que otro firmó.
- **Quién puede aprobar.** `approverRoles`, `approverDirectory` y `forbidSelfApproval` (SPEC-0041): la autoridad del **aprobador** se comprueba contra un directorio de la aplicación.
- **Credenciales por llamada.** `credentialBroker` concede, después de autorizar, una credencial de vida corta para una llamada (SPEC-0042 F4).
- **Evidencia.** El evento de auditoría guarda el hash de los argumentos, la aprobación y su autoridad; el log encadenado se exporta con puntos de control firmados y anclas (SPEC-0042).

**Lo que falta:** nada de lo anterior representa un **apoderamiento**: un documento firmado por un emisor de confianza que dice "este agente puede, de parte de esta persona, hacer esto, sobre esto, hasta esto, hasta esta fecha". La política lo puede imitar, pero no lo verifica ni lo deja como prueba.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué es un apoderamiento para el framework? | Un dato neutro, **`Mandate`**, independiente del formato y del proveedor: `id`, `issuer`, `subject` (la persona o entidad que apodera), `agent` (a quién), `actions` (qué tools o clases de tools), `resources` (sobre qué, opcional), `limits` (por ejemplo importe máximo y moneda, opcional), `validFrom`, `validUntil` y `evidence` (la credencial original o su hash). Nada de DALION ni de eIDAS 2 en el tipo. |
| D2 | ¿Quién lo verifica? | Una interfaz **`MandateVerifier`** en `core`: `verify(request)` devuelve el `Mandate` verificado o un motivo de rechazo. La implementa el operador, un paquete o Steward. El motor nunca ve la credencial en bruto. |
| D3 | ¿Cómo entra en la decisión? | Un ayudante de política, **`mandatePolicy({ verifier, covers })`**, que consulta al verificador y compara la llamada con el alcance. Cubierta -> `allow` (nadie pregunta a nadie). Sin apoderamiento válido -> `deny`. Fuera de alcance -> lo que el operador elija (`ask` por defecto, `deny` si se prefiere). Se combina con las demás políticas con las reglas de siempre: gana el `deny`, y un `ask` pide aprobación. |
| D4 | ¿Falla cerrado? | Sí, en todo: sin verificador, verificador que lanza, apoderamiento caducado, sin vigencia legible, emisor no aceptado o revocado. Una duda no es un permiso. |
| D5 | ¿Qué queda como prueba? | El evento de auditoría guarda el `id` del apoderamiento, su hash, el emisor y el alcance que cubrió la llamada, nunca la credencial completa. Un tercero que tenga la credencial puede comprobar que el hash coincide. |
| D6 | ¿Se puede delegar a otro agente? | Un agente que delega a otro **no le da más poder del que tiene**: el apoderamiento del hijo es un subconjunto del padre (mismo criterio que `checkNarrower` en el sandbox). |
| D7 | ¿Revocación? | El SDK no la resuelve: el verificador recibe un gancho `isRevoked(mandate)` que el operador conecta a su fuente. Sin gancho, solo cuenta la caducidad, y la salida de `verify` lo dice. |
| D8 | ¿Dónde vive la implementación concreta? | En un **paquete opcional**, `agent-mandates` (nombre provisional): un verificador de referencia (credencial firmada contra claves de emisor que el operador configura, con `node:crypto`, el mismo patrón de `trustedKeys` de los bundles de auditoría) y, más adelante, el adaptador del formato real. Steward aporta su propia implementación (confianza, revocación, claves gestionadas) detrás de la misma interfaz. |
| D9 | ¿Quién es la persona a la que se apodera? | **Un identificador del proveedor, con tipo y garantía, que consiente y que el operador mapea.** (a) `Mandate.subject` sigue siendo el `userId` de la aplicación, que es lo que `mandateCovers` compara; el identificador de la persona en el proveedor (`represents`: `id`, `kind` persona o entidad jurídica, `assurance`) viaja aparte y llega a la auditoría. (b) El operador aporta la traducción entre su `userId` y el identificador del proveedor: son espacios de nombres distintos y sin traducción no hay credencial válida. (c) La credencial lleva el **consentimiento de la persona**, su firma sobre los poderes, para que el emisor no pueda conceder ni ensanchar lo que la persona no concedió; sin él se rechaza por defecto, y un despliegue puede aceptarlo dejando `consent: none` en la auditoría. (d) Una credencial **de otra persona** no se trata como fuera de alcance: es **ningún poder** y se deniega sin consultar a nadie. |

## 3. Qué NO hace

- **No autentica a nadie.** El framework sigue sin saber si `userId` es quien dice ser; el apoderamiento dice qué puede hacer el agente de parte de esa persona, no que la persona sea quien afirma. Eso lo prueba el emisor al firmarlo.
- **No decide en qué emisores confiar.** Esa lista la pone el operador. El verificador de referencia no trae ninguna de serie.
- **No implementa los protocolos de la cartera europea** (presentación y verificación estandarizadas de credenciales). Son integración, y dependen del formato (§6).
- **No certifica nada.** Ofrece controles que apoyan normas (trazabilidad, mínimo privilegio, separación de funciones, evidencia verificable); la conformidad es del despliegue y de la organización.

## 4. Fases

| Fase | Contenido | Hecha cuando |
|---|---|---|
| **F0** | Esta especificación y su revisión por quien conoce la credencial. | Revisada por el equipo de Identidad. |
| **F1** | En `core`: los tipos `Mandate` y `MandateVerifier`, `mandatePolicy` y los campos de auditoría. Aditivo, nada cambia por defecto. | Pruebas de cada rechazo (sin verificador, caducado, revocado, fuera de alcance, importe superior) y de que la evidencia queda en el evento. |
| **F2** | Paquete opcional: verificador de referencia, con claves de emisor del operador y un gancho de revocación. | Verifica una credencial firmada de prueba y rechaza una manipulada, de otro emisor o caducada. |
| **F3** | Adaptador del formato de DALION. **Bloqueada** hasta tener el formato. | Una credencial real de DALION se verifica de punta a punta. |
| **F4** | Guía en la web: "qué controles activar para cumplir con un agente sin Steward", cada control mapeado a la pieza del framework. | Publicada, con el mapa de controles revisado por quien conozca las normas. |

## 5. Mapa de controles (borrador, **por revisar**)

Cada fila dice qué pieza del framework apoya qué objetivo de control. Es un punto de partida: la lectura de cada norma la tiene que revisar quien la conozca, y no se afirma compatibilidad con ninguna hasta entonces.

| Objetivo | Pieza | Estado |
|---|---|---|
| Trazabilidad de lo que hizo el agente | Auditoría encadenada, un evento por llamada | Hecha |
| Evidencia verificable por un tercero | Puntos de control firmados, anclas, bundles | Hecha |
| Separación de funciones | `approverRoles`, `forbidSelfApproval` | Hecha |
| Mínimo privilegio | Política, `allowedTools`, sandbox, credenciales por llamada | Hecha |
| Poder delegado con límites y vigencia | Apoderamiento (esta especificación) | Borrador |
| Revocación | Gancho de revocación del verificador | Borrador |
| Supervisión humana de lo irreversible | `destructive`, aprobaciones guardadas, caducidad | Hecha |
| Gestión de claves | Fuera del SDK (KMS, HSM, Steward) | Fuera de alcance |

Normas a mapear, sin afirmar nada todavía: ISO/IEC 42001 (gestión de sistemas de IA), ISO/IEC 27001 (seguridad de la información) y el Reglamento (UE) 2024/1183 (eIDAS 2). Las fechas y los requisitos exactos de eIDAS 2 **no se han verificado** en esta especificación.

## 6. Decisiones abiertas (del autor y del equipo de Identidad)

1. **Formato de la credencial de DALION** y cómo se verifica (firma, cadena de confianza, revocación). Sin esto, F3 no se puede empezar y el verificador de referencia (F2) es una suposición razonable, no una compatibilidad.
2. **¿El límite es por operación o acumulado?** "Hasta 1000 €" puede significar cada compra o la suma de lo comprado. Lo acumulado exige un estado (lo gastado hasta ahora) que alguien tiene que guardar; propuesta: el verificador recibe lo gastado, y el operador decide dónde se guarda.
3. **Unidades y monedas.** Cómo se comparan importes de monedas distintas (propuesta: sin conversión; otra moneda = fuera de alcance).
4. **¿"Fuera de alcance" pide aprobación o se deniega?** Por defecto `ask`, configurable.
5. **Nombre y consulta del paquete.** `agent-mandates` es provisional. Crearlo y publicarlo se consulta antes, como con cualquier paquete nuevo.
6. **Cómo se identifica el agente** en la credencial (un id de agente, una clave pública, ambos) y si coincide con `agentId` del perfil.

7. **El consentimiento de la persona.** D9 propone que la persona firme los poderes. El mecanismo real (una firma suya con una clave que el operador confía, una presentación de su cartera, un acto notarial) **depende de cómo DALION registra el apoderamiento** y no se conoce: queda como suposición declarada del adaptador, igual que el resto del formato.
8. **Qué formato usa DALION, deducido de eIDAS 2.** Si DALION es compatible con eIDAS 2, el **contenedor** de su credencial se deduce de los estándares públicos (§7): SD-JWT VC o ISO mdoc, con divulgación selectiva, vinculación de clave (KB-JWT) y revocación por Token Status List. No se deduce el **contenido** de un poder de representación (no hay esquema público). Queda por confirmar con el equipo de Identidad cuál de los dos formatos usa y los campos del poder. El adaptador del ejemplo (`examples/mandate-agent`) sigue el contenedor y supone el contenido.

## 7. Lo que se revisó del estándar y lo que se hizo (2026-11-22)

**Revisión del estándar** (búsqueda en fuentes públicas el 2026-11-22; lo que no se pudo confirmar se dice):

- **Reglamento (UE) 2024/1183 (eIDAS 2):** publicado el 30 de abril de 2024 y en vigor el 20 de mayo de 2024. La nota del equipo de Identidad habla del 24-dic-2024: lo más probable es que se refiera a los actos de ejecución (por ejemplo el Reglamento de Ejecución (UE) 2024/2977, sobre datos de identificación de la persona y atestaciones electrónicas de atributos, de noviembre de 2024), no al reglamento. No se ha confirmado qué acto exacto es.
- **Formatos de atestación del ecosistema de la cartera europea (EUDI):** el Marco de Referencia y Arquitectura (ARF) define una atestación como un conjunto firmado de atributos en **dos formatos**: mdoc (ISO/IEC 18013-5) y **SD-JWT VC**. ETSI TS 119 472-2 especifica cómo se presentan las atestaciones electrónicas de atributos en SD-JWT VC y en mdoc.
- **SD-JWT VC** (borrador del IETF `draft-ietf-oauth-sd-jwt-vc`, versión -11 de septiembre de 2025; no se confirmó si ya es RFC): un JWT firmado con `iss`, `vct` (tipo de la credencial) y la cabecera `typ` `dc+sd-jwt` (antes `vc+sd-jwt`; se recomienda aceptar ambos en la transición). La divulgación selectiva es opcional. La revocación va por un proveedor de estado separado.
- **Poder de representación (mandatos):** **no se encontró** un perfil específico de apoderamiento en el ARF ni en ETSI TS 119 472-2. Es una atestación de atributos más, con un esquema que define quien la emite. Por eso el formato de DALION es una incógnita real.
- **No cubierto en esta revisión:** OpenID4VCI y OpenID4VP (emisión y presentación), la lista de estado de tokens para revocación, el catálogo de esquemas de atestación y el estado actual del ARF (hay versiones posteriores a las consultadas).

**Decisión que sale de ahí (D8, concretada):** el verificador por defecto lee una credencial **con la forma de un SD-JWT VC** (JWT firmado con `iss`, `sub`, `jti`, `nbf`, `exp`, `vct` y un claim `mandate`), porque es el formato en el que más probablemente llegará un mandato eIDAS 2, y deja el formato real de DALION como adaptador al mismo `Mandate`. No soporta divulgación selectiva ni *key binding* todavía: una credencial que los trae se **rechaza**.

**F1 hecha** (`agent-core` 0.48.8, aditivo): `Mandate`, `MandateVerifier`, `mandatePolicy`, `mandateCovers`, `auditMandate` y el campo `mandate` del evento de auditoría (id, emisor, persona que apodera, vigencia y hash de la credencial; nunca la credencial). Falla cerrado en todo. 17 pruebas, también con el motor: dentro del límite el agente compra sin preguntar y la auditoría nombra el mandato; por encima, sin credencial o con una firmada por otro, no compra.

**F2 hecha** (paquete `@backendkit-labs/agent-mandates` 0.1.0, **sin publicar**): `jwtMandateVerifier`, `issueMandate` (para pruebas, demos y quien se apodera a sí mismo) y las primitivas de JWS (`EdDSA` y `ES256` con `node:crypto`, sin dependencias). Rechaza `none`, los algoritmos simétricos (ataque de confusión de algoritmo) y una clave de otro tipo; exige un emisor que el operador confía, `jti`, `sub` y `exp`; el gancho de revocación, si falla, cuenta como revocado. 23 pruebas, incluido un ejemplo de extremo a extremo y los casos de credenciales falsificadas.

**Decisiones de §6 ya tomadas para el verificador por defecto:** el límite es **por operación** (el acumulado queda abierto), una moneda distinta es **fuera de alcance**, "fuera de alcance" **pide aprobación** por defecto y es configurable, y el agente se identifica por `agent` (el `id` del perfil). El resto sigue abierto hasta tener el formato de DALION.

**F4 escrita (2026-11-23), sin cumplir su criterio:** la guía está en la web (`guides/controls-for-an-agent-without-steward`), con el mapa de controles de §5 y cada control enlazado a su pieza; verificados en el código los nombres de API que cita. Lleva un aviso visible de que es un **borrador no revisado contra ninguna norma** y no afirma cumplimiento. El criterio de la fase pide que **quien conozca las normas revise el mapa**: eso no se ha hecho, así que la fase no está cerrada. No se verificaron las fechas ni los actos de ejecución de eIDAS 2 y la guía lo dice.

**Qué se deduce de eIDAS 2 (2026-11-23).** Una búsqueda en fuentes públicas confirmó: el formato base SD-JWT es ahora el **RFC 9901** (la vinculación de clave se hace con un KB-JWT: `typ` `kb+jwt`, `iat`, `aud`, `nonce` y `sd_hash`); el **SD-JWT VC** sigue siendo un borrador del IETF (se vio la revisión -26), con `vct` como nombre resistente a colisiones y `typ` `dc+sd-jwt` (se acepta `vc+sd-jwt` en la transición); y la **Token Status List** también es un borrador (revisión -21; la forma `status.status_list.{idx, uri}`, con listas `statuslist+jwt` en las que 0 es válido y 1 inválido; las primeras revisiones ponían `idx` y `uri` directamente bajo `status`). **No se encontró** un esquema público de poder de representación: el ARF define el PID como el de una persona natural que representa a una jurídica, los "digital power of attorney" figuran como casos de uso planificados de las carteras de empresa, el texto del Consejo sobre mandatos sigue en negociación, y no se leyó el ETSI TR 119 479-1 (mayo de 2026). El ejemplo `mandate-agent` sigue el contenedor deducido y supone el contenido. **Pendiente de leer y confirmar:** los pasos exactos de validación del KB-JWT del RFC 9901 (§7.3), la cadena de confianza (`x5c`, listas de confianza) y OpenID4VP (cómo se presenta).

**Pendiente:** F3 (adaptador de DALION): **no se puede hacer** sin el formato real de la credencial; inventar uno sería una suposición presentada como compatibilidad. La revisión de la guía de F4 por quien conozca las normas.
