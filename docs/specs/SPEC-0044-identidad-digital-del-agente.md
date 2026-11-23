# SPEC-0044: identidad digital del agente (un agente lleva una identidad, y la lleva en cada acción)

**Fecha:** 2026-11-23
**Estado:** **Borrador.** F0 pendiente de revisión por el autor y por el equipo de Identidad. Nada implementado. **La identidad obligatoria es el destino de esta especificación, no una posibilidad** (D8, F5).
**Origen:** la revisión del ejemplo `mandate-agent` (2026-11-23), que enseñó que SPEC-0043 cubre el **apoderamiento** pero deja sin cubrir la **identidad del agente**. Una credencial de apoderamiento dice qué puede hacer un agente; nada en el framework dice **quién es** el agente que la presenta, ni deja constancia de **qué identidad** ejecutó cada acción. El autor lo planteó como requisito de **cualquier agente que se cree**, no de un agente concreto ni de un proveedor concreto (2026-11-23).
**Depende de:** `Principal` y la política (`governance/types.ts`), la auditoría encadenada con puntos de control firmados (SPEC-0042), el apoderamiento (SPEC-0043).
**Tipo de cambio:** aditivo en `core` por fases; el paso final (F5) **cambia un valor por defecto** y es una ruptura declarada, con aviso previo. `agent-mandates` y los ejemplos se adaptan. Nada se publica sin consulta.
**Objetivo:** que todo agente que actúa lleve una **identidad digital propia, no humana, verificable y neutral al proveedor**; que cada acción quede atribuida a esa identidad con una prueba que un tercero pueda comprobar; y que un apoderamiento se ate a la identidad del agente que lo usa, y no a un nombre.

## 1. De dónde se parte

- **El `Principal` no tiene identidad del agente.** Tiene `agentId` (el id interno del perfil: `buyer`), `chain` (ids de perfil), y el humano (`userId`, `tenantId`). El `agentId` lo elige quien escribe el perfil: no lo emite nadie ni se puede comprobar.
- **La auditoría atribuye al perfil, no a una identidad.** El evento guarda `principal.agentId`, la cadena de delegación y, si hubo, el apoderamiento. No guarda con qué identidad digital actuó el agente.
- **"La acción se firma" solo ocurre a nivel de cabeza de cadena**, con el `CheckpointSigner` que configure el operador (SPEC-0042). Ningún evento queda firmado por quien lo ejecutó.
- **El apoderamiento se ata a un nombre.** `Mandate.agent` se compara con `principal.agentId`. Un adaptador que quiera atarlo a una identidad lleva su propia tabla (`agentIdentityOf` en el ejemplo `mandate-agent`), y nada de eso llega a la auditoría.
- **Una credencial sin vinculación de clave es un billete al portador.** Quien consigue la cadena la presenta como si fuera el agente. Hoy el verificador de referencia rechaza las credenciales con vinculación de clave en lugar de usarla.
- **`CheckpointSigner.sign` es síncrono.** Una clave en un KMS o un HSM firma de forma asíncrona.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué es la identidad de un agente? | Un dato neutro, **`AgentIdentity`**: `id` (estable y único para su emisor; puede ser un DID, un URN o un id interno, el framework no lo interpreta), `issuer` (quién la emitió, opcional) y `kid` (la clave con la que firma, opcional). No es una credencial ni un formato: lo que significa lo decide el proveedor. |
| D2 | ¿Quién la da? | Una interfaz **`AgentIdentityProvider`** en `core`, igual que `MandateVerifier`: `resolve(agentId)` devuelve la identidad de ese agente o `undefined`, y `sign(agentId, mensaje)` devuelve una firma, **de forma asíncrona**. El framework no tiene por qué custodiar la clave privada: puede estar en un KMS, un HSM, el custodio del proveedor de identidad o, en pruebas, en memoria. |
| D3 | ¿Cómo entra en el motor? | Opción `agentIdentity` de `createBaseEngine`. El motor resuelve la identidad de cada llamada y la pone en el **`Principal`** (`principal.agentIdentity`). Cada sub-agente tiene la suya; la cadena de delegación lleva las identidades además de los ids de perfil. |
| D4 | ¿Cómo queda como prueba? | El **evento de auditoría** gana `agentIdentity` (id, emisor, `kid`). Y la identidad **firma**: propuesta, **cada evento**, con la clave del agente que lo ejecutó (ver §6, pregunta 1: una cadena compartida por varios agentes no tiene sentido firmada en su cabeza por uno solo). `verifyAuditChain` aprende a comprobar esas firmas con las claves públicas que el verificador aporte. |
| D5 | ¿Cómo se ata un apoderamiento? | **`Mandate.agentIdentity`** (el `id` de la identidad a la que apodera). `mandateCovers` lo compara con `principal.agentIdentity?.id` y **falla cerrado** si el apoderamiento exige identidad y el motor no tiene una para ese agente. Los adaptadores dejan de llevar su propia tabla. `Mandate.agent` (el id de perfil) sigue existiendo. |
| D6 | ¿Y la prueba de posesión? | El motor da al verificador una función **`prove(reto)`** que firma con la clave de la identidad (D2). Un adaptador cuya credencial esté atada a una clave comprueba esa firma contra ella. El framework no sabe de formatos: solo ofrece la prueba. El `Mandate` lleva **`holderBinding: 'proven' | 'none'`** y la auditoría lo registra, de modo que la evidencia dice si se demostró la posesión o si la credencial se aceptó "al portador". |
| D7 | ¿Y los agentes que delegan? | La identidad de un agente que delega no le da la suya a otro. Cada agente en la cadena lleva la suya, y la auditoría guarda la cadena de identidades. Un sub-agente sin identidad, con `requireAgentIdentity` activa, se deniega. |
| **D8** | **¿Es obligatoria?** | **Sí. Un agente que actúa lleva una identidad.** Es el estado final del framework. Se llega por pasos para no romper a quien ya usa el SDK: primero opcional (`requireAgentIdentity: false`), después con **advertencia** por cada agente gobernado sin identidad, y por último **obligatoria por defecto** (F5). Desde F5 un agente sin identidad se deniega, y el opt-out explícito (`requireAgentIdentity: false`) queda para pruebas y se documenta como **no apto para entornos regulados**. |
| D9 | ¿Se ata a un proveedor? | **No.** Ningún tipo de `core` nombra a un proveedor. DALION, una identidad corporativa, una cartera o una tabla propia del operador son proveedores iguales detrás de las mismas dos interfaces (`AgentIdentityProvider` y `MandateVerifier`). Varios pueden convivir (SPEC-0043, ejemplo `mandate-agent`). |
| D10 | ¿Compatibilidad de los registros? | Todo lo que se añade al evento es **opcional**: los registros anteriores siguen verificando, y un evento sin identidad sigue siendo válido mientras `requireAgentIdentity` esté apagada. La forma canónica que entra en el hash solo incluye los campos nuevos cuando están presentes. |

## 3. Qué NO hace

- **No crea identidades ni decide quién merece una.** Las da un proveedor. El framework solo las exige, las propaga y las deja como prueba.
- **No autentica al humano.** `userId` sigue siendo lo que dice la aplicación (SPEC-0043 §3).
- **No custodia claves** (ni las gestiona, rota o recupera). Eso es del KMS, del HSM o del proveedor.
- **Tener identidad no es tener permiso.** La identidad dice quién actúa; qué puede hacer lo siguen diciendo la política y el apoderamiento.
- **No certifica nada** ni afirma conformidad con ISO/IEC 42001, ISO/IEC 27001 o eIDAS 2. Ofrece un control (atribución verificable de cada acción) que apoya esos objetivos; la conformidad es del despliegue y de la organización, y el mapa de controles lo revisa quien conozca las normas (SPEC-0043 §5).

## 4. Fases

| Fase | Contenido | Hecha cuando |
|---|---|---|
| **F0** | Esta especificación, revisada por el autor y por el equipo de Identidad. | Revisada; las preguntas de §6 cerradas. |
| **F1** | En `core`: `AgentIdentity`, `AgentIdentityProvider`, opción `agentIdentity`, `principal.agentIdentity` (con la cadena de identidades en la delegación) y el campo `agentIdentity` del evento de auditoría. Un proveedor de referencia en memoria (`staticAgentIdentities`) para pruebas y demos. **Aditivo: sin proveedor, nada cambia.** | Pruebas: la identidad llega al `Principal` y a la auditoría en una llamada, en una delegación y en un sub-agente; sin proveedor el comportamiento y los registros son los de hoy (la suite existente pasa sin cambios). |
| **F2** | En `core`: la firma. `CheckpointSigner` acepta una firma asíncrona (aditivo), cada evento se firma con la identidad que lo ejecutó, y `verifyAuditChain` y los bundles verifican esas firmas. | Un evento editado, un evento firmado por **otra** identidad y una firma con una clave que no es la de la identidad fallan; un firmante asíncrono (como un KMS) funciona; el coste por llamada está medido y documentado. |
| **F3** | Apoderamiento atado a la identidad: `Mandate.agentIdentity`, `mandateCovers`, `prove(reto)` en `MandateRequest`, `holderBinding` en el apoderamiento y en la auditoría. En `agent-mandates`: el verificador de referencia admite credenciales atadas a una clave. | Una credencial atada a una clave se **rechaza** cuando quien la presenta no tiene la clave y se **acepta** cuando la tiene; la auditoría dice cuál de las dos fue; una credencial al portador sigue aceptándose solo si el operador lo permite, y queda marcada `none`. |
| **F4** | **Advertencia y opt-in.** Con `requireAgentIdentity: true` un agente sin identidad se deniega; con un motor gobernado y la opción apagada, cada agente sin identidad produce **una advertencia** (una vez por proceso) en el transporte y queda anotado en la auditoría que no la tenía. Guía en la web y guía de migración. El ejemplo `mandate-agent` se adapta (identidad, firma y prueba de posesión, bajo más de un proveedor). El testkit trae una identidad de prueba para que las pruebas no necesiten montaje. | Publicado; el ejemplo demuestra el mismo agente bajo al menos dos proveedores de identidad; la advertencia sale en un motor gobernado sin identidad y no sale en uno que la tiene. |
| **F5** | **Obligatoria por defecto.** `requireAgentIdentity` pasa a `true` por defecto. Un agente sin identidad se deniega. Cambio declarado en el CHANGELOG como **ruptura**, con la guía de migración de F4 enlazada. | **Condición de entrada:** F1 a F4 publicadas y la advertencia de F4 viva durante **al menos dos versiones** de `agent-core`. **Hecha cuando:** el valor por defecto es `true`, el opt-out explícito sigue funcionando y está marcado como no apto para entornos regulados, y hay una prueba que falla si alguien vuelve a poner `false` por defecto. |

**La obligatoriedad no se aplaza sin decisión explícita.** F5 está en el plan desde el primer día: si alguna de las condiciones de entrada se cumple y F5 no se hace, quien lo decida deja constancia por escrito en esta especificación del motivo y de la fecha de revisión.

## 5. Riesgos y cómo se tratan

- **Ruptura para quien ya usa el SDK.** F5 es la única fase que rompe, y llega después de dos versiones con advertencia, una guía de migración y un opt-out explícito. Hasta entonces todo es aditivo.
- **Fricción en pruebas y demos.** Exigir identidad a todo agente molesta a quien solo prueba. El proveedor en memoria (F1) y la identidad de prueba del testkit (F4) evitan que sea un montaje.
- **Coste de firmar cada acción.** Una firma Ed25519 local cuesta microsegundos; en un KMS, milisegundos por llamada. F2 lo mide y lo documenta; y la pregunta 1 de §6 deja abierta una firma por lotes.
- **Una identidad de papel.** Atar el apoderamiento a un texto no prueba nada. Por eso D6: sin prueba de posesión, la auditoría lo dice (`holderBinding: none`) en lugar de aparentar una garantía que no hay.
- **Acoplar el framework a un proveedor.** Se evita por contrato (D9): dos interfaces neutrales, y un ejemplo que corre el mismo agente bajo proveedores distintos.
- **Una clave perdida o comprometida.** Es del custodio. El framework deja constancia del `kid` en cada evento para que una clave retirada se pueda señalar, pero no gestiona la revocación de la clave (igual que SPEC-0043 D7).

## 6. Decisiones abiertas

1. **¿Qué firma, y con qué granularidad?** El `CheckpointSigner` de hoy firma la cabeza de **una** cadena con **una** clave. Con varios agentes en la misma cadena, "firmado por el agente" solo tiene sentido **por evento** (o con una cadena por agente). Propuesta: **una firma por evento**, con la opción de firmar la cabeza cada N eventos cuando el coste importe.
2. **¿Cuántas versiones de advertencia antes de F5?** Propuesta: **dos**. Es una cifra de partida.
3. **¿Dónde se declara la identidad de un agente?** Propuesta: **solo en el proveedor** (`resolve(agentId)`), sin tocar el perfil. Para un agente cargado desde archivos o servido por MCP, el proveedor decide con el `agentId`.
4. **Agentes efímeros o creados en ejecución.** Un sub-agente creado al vuelo, ¿hereda una identidad derivada de la del padre (`padre/hijo`) o necesita la suya? Propuesta: **derivada y firmada por el padre**, y la auditoría guarda ambas.
5. **Nombres.** `AgentIdentity` y `AgentIdentityProvider` son provisionales.
6. **¿Qué hace el motor si el proveedor falla?** Propuesta: falla cerrado (la llamada se deniega con el motivo), como con el verificador de apoderamientos.

## 7. Registro

- **2026-11-23, origen.** La revisión del ejemplo `mandate-agent` mostró cuatro huecos: el agente nunca demuestra ser quien dice (la credencial se comprobaba contra una tabla del operador, no contra una clave); la identidad digital no queda en la auditoría (`Mandate.agent` llevaba el id de perfil, no el identificador digital); la clave que firmaba la cabeza de la cadena era una efímera generada en cada ejecución, no la de ninguna identidad; y el `Principal` no tiene dónde llevar la identidad del agente. Se rechazó arreglarlo solo en el ejemplo: es un requisito de cualquier agente.
- **2026-11-23, decisión del autor.** Se escribe como SPEC-0044, en borrador, **y la obligatoriedad queda registrada** (D8, F5): un agente debe llevar una identidad.
