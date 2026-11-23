# mandate-agent

Un agente de compras que actúa **bajo un apoderamiento, lo emita quien lo emita**. La credencial dice **para quién** trabaja (el humano), **qué** puede hacer (comprar), **sobre qué** (una televisión) y **hasta qué importe** (1000 €). Dentro de eso compra solo; fuera de eso pregunta a una persona; sin un apoderamiento válido no hace nada y no pregunta a nadie. Cada llamada queda en un registro de auditoría encadenado con el apoderamiento bajo el que se ejecutó, y la cabeza de la cadena se firma.

## El framework no se ata a un proveedor de identidad

Este ejemplo lo demuestra, no solo lo afirma:

- **`agent.ts` no conoce ningún proveedor.** Recibe un `MandateVerifier` (el contrato de `agent-core`) y nada más. Un test comprueba que su código no nombra a ningún proveedor ni importa nada de `providers/`.
- **Los proveedores viven en `providers/`** y cada uno es un adaptador detrás de ese mismo contrato:
  - `dalion-assumed.ts`: DALION, con un formato **supuesto** (ver abajo). Habla en verbos del dominio.
  - El **perfil de referencia** de `@backendkit-labs/agent-mandates` (`jwtMandateVerifier`): nombra herramientas.
  - Una **tabla propia del operador** (en los tests): sin credencial ni criptografía, responde el mismo contrato.
- **`router.ts`** pone varios proveedores detrás de **un** verificador, para un operador que trabaja con más de uno. Enruta por el `iss` de la credencial **leído sin verificar**; eso es seguro porque solo elige quién la juzga: el verificador elegido comprueba la firma con las claves que ÉL confía para ese emisor. Una credencial que dice ser de un proveedor pero está firmada con la clave de otro se rechaza.
- **El mismo agente, sin cambiar una línea**, pasa los mismos casos (compra dentro del límite, pregunta fuera, nada sin credencial) bajo DALION, bajo el perfil de referencia y bajo la tabla del operador. Y la auditoría nombra el emisor del mandato que cubrió cada llamada, sea cual sea.

Cambiar de proveedor, o sumar uno, es **cableado del operador**, no una decisión del agente.

> **El formato de la credencial de DALION es SUPUESTO.** Todavía no se conoce el real (SPEC-0043 §6; la F3 está bloqueada por eso). `src/providers/dalion-assumed.ts` fija una forma inventada a partir de lo que se sabe del producto, para poder construir y probar ya el agente, la política, la auditoría y los casos de fallo. **No demuestra compatibilidad con DALION.** Cuando llegue el formato real, lo único que cambia es ese adaptador; los tests de `src/__tests__/mandate-agent.test.ts` son el contrato que el nuevo adaptador tiene que seguir cumpliendo.

## La identidad digital del agente (maqueta de SPEC-0044)

Una credencial de apoderamiento dice qué puede hacer un agente; no dice **quién es** el agente que la presenta. [SPEC-0044](../../docs/specs/SPEC-0044-identidad-digital-del-agente.md) propone que todo agente lleve una identidad digital, y este ejemplo **prueba el diseño antes de tocar `agent-core`**, en `src/identity/prototype.ts`. Es una maqueta: cada apaño está marcado `CORE:` con el cambio del framework que lo hará desaparecer. **No es una API del framework.**

```
proveedor de identidad  ──resolve(agentId)──▶  { id, issuer, kid }   la identidad la da el PROVEEDOR, nunca la credencial
        │                                            │
        └──sign(agentId, mensaje)──▶  firma          ▼
                                       Principal.agentIdentity ──▶ verificador (compara con el sub de la credencial)
                                                     │                      + prueba de posesión de la clave
                                                     ▼
                                      evento de auditoría: agentIdentity + agentSignature (firmado por esa identidad)
```

- **Dos proveedores distintos detrás del mismo contrato** (`AgentIdentityProvider`): DALION (supuesto, DID, clave en custodia) y un IAM de empresa (URN, clave en un KMS). Ambos firman de forma **asíncrona**.
- **La identidad sale del proveedor, no de la credencial.** La credencial la presenta el propio agente: fiarse de lo que dice de sí misma sería circular. Su `sub` se **compara** con lo que dice el proveedor.
- **Cada evento queda atribuido y firmado** por la identidad que lo ejecutó (también los denegados y los de solo lectura). `verifyAgentSignatures` lo comprueba evento a evento, **independientemente** de la cadena de hashes: un evento editado y re-encadenado sigue fallando, porque la firma cubre el contenido.
- **Prueba de posesión.** Una credencial atada a la clave del agente (`cnf`) solo sirve a quien tiene esa clave: el agente firma un reto nuevo y se comprueba contra la clave de la credencial. Hay un test del caso que antes pasaba: **el mismo nombre de identidad con otra clave**, que ahora se rechaza. Una credencial al portador (sin clave) se acepta por defecto y la auditoría la marca `holderBinding: none`, para no aparentar una posesión que nadie probó; un despliegue puede exigir la prueba (`requireHolderBinding`).
- **Obligatoria (SPEC-0044 D8).** Con `require: true` un agente sin identidad se deniega, también en una consulta de solo lectura, y la auditoría dice `agentIdentityMissing`. Con `false` (la transición) funciona, avisa **una vez** y deja constancia en el registro.
- **Un proveedor que falla es un rechazo, no un permiso.** Y una **custodia que no puede firmar no pierde el registro**: el evento se escribe marcado `agentSignatureFailed`, y la verificación lo señala para que no pase por firmado. Un registro perdido es peor que uno sin firma.

Los tests de la identidad están en `src/__tests__/identity.test.ts` (21 casos); cada pieza se defiende por sí sola (el adaptador, la capa del verificador y la política no se apoyan unas en otras).

## La credencial habla del dominio, no del código

La credencial de DALION **no dice qué herramientas puede ejecutar el agente**. Dice un **verbo** (`buy`), un **objeto** (`television`) y un **importe**. Qué herramienta de *este* agente realiza "comprar" lo declara **la propia herramienta**, en el campo de metadatos que el framework reserva para los clientes de gobernanza (`ToolDefinition.meta`), nunca la credencial:

```ts
defineTool({
  name: 'buy_supplies',
  destructive: true,
  meta: { capability: 'buy' },        // el verbo que realiza, en el vocabulario de la credencial
  // ...
});
// y objectOf: (args) => args.item     // sobre qué actúa una llamada, lo lee quien despliega el agente
```

Así, renombrar una herramienta no toca la credencial, y una herramienta que no declara ningún verbo **nunca** queda cubierta por un proveedor que habla en verbos. Un proveedor que nombra herramientas (el perfil de referencia) no necesita nada de esto.

## Qué se supone del contenedor de DALION

Un JWT con forma de SD-JWT VC, firmado por el emisor (`iss`):

| Campo | Qué es |
|---|---|
| `sub` | La identidad **no humana del agente** (`did:dalion:agent:buyer-01`), no la de la persona |
| `represents.id` | Para quién trabaja el agente |
| `powers[]` | `{ action, object?, max?: { value, currency } }`: un verbo, opcionalmente el objeto, opcionalmente un límite. **Sin nombres de herramientas** |
| `status.id` | Lo que usa la consulta de revocación |
| `jti`, `nbf`, `exp` | Id y vigencia. **`exp` es obligatorio**: un poder sin fin no se acepta |
| `vct` | Nombra este formato supuesto |

Un poder sin `object` cubre cualquier objeto (con su propio límite); uno con `object` gana sobre él para ese objeto.

## Qué decide el adaptador de DALION (y falla cerrado en cada punto)

Algoritmo y `typ` en lista blanca (`none` y los simétricos, fuera); emisor que el operador confía, con su clave; firma válida; la identidad del agente en `sub` es la que el operador registró para ese agente; vigencia; poderes bien formados, **sin comodín (ni de verbo ni de objeto) y sin (verbo, objeto) repetido**; un límite sin moneda se rechaza; y si la consulta de revocación falla, cuenta como revocado.

Responde **por llamada**: toma el verbo que declara la herramienta llamada, busca el poder de ese verbo y de ese objeto, y devuelve un `Mandate` que cubre esa herramienta con el objeto y el límite de ese poder. La política (`mandatePolicy` de `agent-core`) no cambia. Una herramienta **de solo lectura** (consultar un precio) no necesita mandato: la decide la regla del propio framework (`defaultToolPolicy`). No se puede listar `defaultToolPolicy` junto a `mandatePolicy` (pide aprobación para toda herramienta destructiva y un `ask` gana a un `allow`, lo que anularía el mandato), así que el reparto se hace por el `readOnly` que declara la herramienta.

## Piezas

- `src/agent.ts`: el agente (`buildBuyerAgent`): motor real, `mandatePolicy`, aprobador, auditoría encadenada con puntos de control firmados. **Sin proveedor.**
- `src/capability.ts`: la clave de `meta` donde una herramienta declara su verbo.
- `src/providers/dalion-assumed.ts`: el adaptador de DALION (supuesto).
- `src/providers/dalion-sim.ts`: un DALION de mentira que emite credenciales en ese formato y lleva una lista de revocados.
- `src/providers/router.ts`: varios proveedores detrás de un verificador.
- `src/identity/prototype.ts`: la maqueta de SPEC-0044 (la capa de identidad, la firma de la auditoría y su verificación).
- `src/identity/corporate-identity.ts`: un segundo proveedor de identidad (IAM de empresa con KMS).
- `src/__tests__/mandate-agent.test.ts`: 48 casos de extremo a extremo bajo DALION (el contrato del adaptador).
- `src/__tests__/providers.test.ts`: 14 casos de neutralidad: el mismo agente bajo tres proveedores y bajo varios a la vez.
- `src/__tests__/identity.test.ts`: 21 casos de la identidad del agente (atribución, firma, prueba de posesión, obligatoriedad).

```bash
npm install
npm test
```

## Qué demuestran los tests de DALION

- **Dentro** (comprar una televisión, hasta 1000 €): compra sin preguntar, la auditoría nombra el mandato (id, emisor, persona, hash de la credencial) y la credencial **no** aparece en el registro. Exactamente 1000 entra. Consultar un precio no necesita mandato. La credencial no contiene ningún nombre de herramienta.
- **Fuera** → **pregunta**: 1200 €, **otro objeto** (un portátil no es una televisión), una llamada que no dice qué compra, **otro verbo** (puede comprar, no firmar), una herramienta que no declara ningún verbo, otra moneda, un importe negativo, o un mandato de otra persona. Aprobado, compra; rechazado o sin aprobador, no.
- **Varios poderes**: cada objeto tiene su límite (portátil hasta 2500, televisión hasta 1000), y un poder sin objeto cubre el resto con el suyo.
- **Desacople**: otro vocabulario con el mismo agente solo cambia el verbo que declara la herramienta; una credencial que **nombra una herramienta** no concede nada.
- **Sin mandato válido** → **denegado, y el aprobador ni se consulta**. Cada caso se comprueba por **su motivo**: sin credencial, firmada por otro, emisor no confiable, caducada, aún no vigente, sin `exp`, emitida a otro agente, sin poderes, comodín de verbo u objeto, poder repetido, límite sin moneda o no numérico, objeto inválido, sin persona representada, otro tipo, divulgaciones selectivas, basura, payload editado, `alg: none`, confusión de algoritmo (HMAC firmado con la clave **pública**), origen que lanza, revocación que no responde y credencial revocada.
- **Revocación a mitad de camino**: revocada entre dos compras, la segunda no pasa.
- **Auditoría**: la cadena verifica, su cabeza está firmada, y editarla después se detecta.

Se comprobó que los tests tienen dientes: debilitaciones deliberadas del adaptador, de la política y del enrutador (sin comprobar la identidad del agente, sin firma, ignorando el objeto, usar el nombre de la herramienta como verbo, que el poder genérico gane al específico, comodín de objeto, revocación que falla abierta, sujeto tomado del que llama, exigir mandato también a las herramientas de solo lectura, ignorar el mandato, o que un emisor desconocido caiga en el primer proveedor) rompen cada una al menos un test.

## Lo que NO hace (a propósito)

- **El límite es por operación, no acumulado.** Dos compras de 600 pasan bajo un mandato de 1000. Es lo que hace el verificador de referencia (SPEC-0043 §6, pregunta 2) y hay un test que lo documenta. Si la credencial real significa un **total**, el adaptador tiene que guardar lo gastado y ese test cambia con él.
- **El objeto se compara por texto exacto.** Si el modelo dice «TV» en vez de «television», **pregunta**: es seguro pero incómodo. La normalización (o un catálogo de objetos) es una decisión de quien despliega el agente.
- **No autentica a nadie.** `identity.userId` es lo que dice la aplicación; el mandato dice qué puede hacer el agente por esa persona.
- **No gestiona claves ni la fuente de revocación.** La lista de emisores confiables y dónde se consulta el estado son del operador.
- **Sin divulgación selectiva ni *key binding*:** una credencial que los trae se rechaza.
- **El enrutador no es parte del framework.** Es una pieza de este ejemplo. Si varios operadores lo necesitan, la propuesta es llevarlo a `agent-mandates`.
