# mandate-agent

Un agente de compras que actúa **bajo un apoderamiento, lo emita quien lo emita**. La credencial dice **para quién** trabaja (el humano), **qué** puede hacer (comprar), **sobre qué** (una televisión) y **hasta qué importe** (1000 €). Dentro de eso compra solo; fuera de eso pregunta a una persona; sin un apoderamiento válido no hace nada y no pregunta a nadie. Cada llamada queda en un registro de auditoría encadenado con el apoderamiento bajo el que se ejecutó, y la cabeza de la cadena se firma.

## El framework no se ata a un proveedor de identidad

Este ejemplo lo demuestra, no solo lo afirma:

- **`agent.ts` no conoce ningún proveedor.** Recibe un `MandateVerifier` (el contrato de `agent-core`) y nada más. Un test comprueba que su código no nombra a ningún proveedor ni importa nada de `providers/`.
- **Los proveedores viven en `providers/`** y cada uno es un adaptador detrás de ese mismo contrato:
  - `dalion-assumed.ts`: DALION, con un contenedor **deducido de eIDAS 2** y un contenido **supuesto** (ver abajo). Habla en verbos del dominio.
  - El **perfil de referencia** de `@backendkit-labs/agent-mandates` (`jwtMandateVerifier`): nombra herramientas.
  - Una **tabla propia del operador** (en los tests): sin credencial ni criptografía, responde el mismo contrato.
- **`router.ts`** pone varios proveedores detrás de **un** verificador, para un operador que trabaja con más de uno. Enruta por el `iss` de la credencial **leído sin verificar**; eso es seguro porque solo elige quién la juzga: el verificador elegido comprueba la firma con las claves que ÉL confía para ese emisor. Una credencial que dice ser de un proveedor pero está firmada con la clave de otro se rechaza.
- **El mismo agente, sin cambiar una línea**, pasa los mismos casos (compra dentro del límite, pregunta fuera, nada sin credencial) bajo DALION, bajo el perfil de referencia y bajo la tabla del operador. Y la auditoría nombra el emisor del mandato que cubrió cada llamada, sea cual sea.

Cambiar de proveedor, o sumar uno, es **cableado del operador**, no una decisión del agente.

> **Qué se deduce y qué se supone del formato de DALION.** El formato real de DALION no se conoce (SPEC-0043 §6; la F3 está bloqueada por eso). Pero DALION se describe como **compatible con eIDAS 2**, y los formatos de atestación de ese ecosistema son públicos, así que el **contenedor** se deduce de ahí y no se inventa: un **SD-JWT VC** (RFC 9901 y el borrador SD-JWT VC; el otro formato de la cartera europea es ISO mdoc), con divulgación selectiva, vinculación de clave por `cnf` y un **Key Binding JWT**, y revocación por referencia a una **Token Status List**. Lo que **no** se puede deducir es el **contenido** de una atestación de poder de representación: no se encontró un esquema público (el ARF define a una persona natural que representa a una jurídica y planea el "poder digital" como caso de uso de las carteras de empresa, sin campos). Por eso los campos `represents`, `powers` y el consentimiento siguen siendo **supuestos**. **Nada de esto demuestra compatibilidad con DALION**; los tests de `src/__tests__/` son el contrato que el adaptador real tiene que seguir cumpliendo.

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

## Para quién trabaja: el humano de la credencial

La credencial dice para quién trabaja el agente. Eso no es solo un texto que la aplicación declara y la credencial repite:

- **Se mapea.** La aplicación dice `u-1001`; DALION dice `did:dalion:person:carlos`. Son espacios de nombres distintos, y el operador aporta la traducción (`humanIdOf`). Sin traducción, la credencial se rechaza.
- **Es estructurado.** `represents` lleva `id`, `kind` (**persona** o **entidad jurídica**) y `assurance` (con qué garantía se identificó a la persona: `low`, `substantial`, `high`). Un despliegue puede exigir un mínimo (`minAssurance`); sin mínimo, solo se registra.
- **La persona consiente.** La persona firma con su propia clave lo que el agente puede hacer por ella (el agente, los poderes y la fecha de fin). Sin esa firma el emisor podría conceder poderes que nadie concedió; con ella, **el emisor no puede ensancharlos después**: aunque vuelva a firmar la credencial con una clave válida y suba el límite, la firma de la persona ya no cubre lo que dice y se rechaza. Tampoco puede añadir un poder ni pasarle el consentimiento a otro agente. Sin consentimiento, se rechaza (`requireConsent`); un despliegue puede aceptarlo y la auditoría dice `consent: none`.
- **Una credencial de otra persona no es "fuera de alcance": es ningún poder.** Se **deniega** y nadie es consultado, en vez de pedir a un humano que apruebe algo que ni siquiera es de esta persona.
- **La auditoría lo registra** (`represents`: identificador, tipo, garantía y si el consentimiento se verificó), además del `subject` con el id de la aplicación.

Los tests están en `src/__tests__/human.test.ts` (16 casos). **El mecanismo del consentimiento es SUPUESTO**, como el resto del formato de DALION: no sé cómo lo registra el real.

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

**Fuentes consultadas** (los borradores del IETF cambian de revisión): [RFC 9901, SD-JWT](https://www.rfc-editor.org/rfc/rfc9901.html), [SD-JWT VC](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/), [Token Status List](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/) y el [ARF de la cartera europea](https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/arf).

## Qué se deduce de eIDAS 2 y qué se supone

**Deducido (estándares públicos; los borradores del IETF pueden cambiar):**

| Aspecto | Qué dice el estándar | Dónde está en el ejemplo |
|---|---|---|
| Formato | SD-JWT VC, `typ` `dc+sd-jwt` (se acepta también `vc+sd-jwt`), `vct` como nombre del tipo | `dalion-assumed.ts` |
| Divulgación selectiva | Las Disclosures `[sal, nombre, valor]` y los resúmenes en `_sd`; se rechazan la duplicada, la no referenciada, la que pisa otro claim, `_sd`/`...` como nombre y un algoritmo distinto de SHA-256 | `standards/sd-jwt.ts` |
| Vinculación de clave | `cnf` en la credencial y un **KB-JWT** (`typ` `kb+jwt`) con `iat`, `aud`, `nonce` y `sd_hash` sobre `<jwt>~<disclosures>~`, firmado con esa clave | `standards/sd-jwt.ts`, `dalion-assumed.ts` |
| Revocación | Referencia a una **Token Status List**: `status.status_list.{idx, uri}` | `dalion-assumed.ts` (el operador aporta la consulta) |
| Confianza en el emisor | En un relying party real: `x5c` y listas de confianza | **No se implementa**: el operador lista las claves de emisor |

**Supuesto (no se encontró un esquema público de un poder de representación):** el contenido. Un JWT con `iss`, `sub`, `jti`, `nbf`, `exp`, `vct` propio y:

| Campo | Qué es |
|---|---|
| `sub` | La identidad **no humana del agente** (`did:dalion:agent:buyer-01`), no la de la persona |
| `represents.id` | Para quién trabaja el agente |
| `powers[]` | `{ action, object?, max?: { value, currency } }`: un verbo, opcionalmente el objeto, opcionalmente un límite. **Sin nombres de herramientas** |
| `status.status_list` | `{ idx, uri }`: la referencia a la Token Status List |
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
- `src/__tests__/human.test.ts`: 16 casos del humano de la credencial (mapeo, tipo y garantía, consentimiento, credencial de otra persona).
- `src/standards/sd-jwt.ts`: el contenedor SD-JWT (RFC 9901), **neutral al proveedor**: Disclosures, KB-JWT y su verificación.
- `src/__tests__/sd-jwt.test.ts`: 24 casos del contenedor, con los rechazos que el RFC exige a un verificador.
- `src/__tests__/eidas.test.ts`: 11 casos de la credencial como la llevaría una cartera eIDAS 2 (divulgación selectiva, KB-JWT, Token Status List).

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
- **No construye la cadena de confianza del emisor.** Un relying party de la cartera europea usaría `x5c` y las listas de confianza; aquí el operador lista las claves de los emisores.
- **Solo EdDSA para la clave del titular**, y no se descarga ni se valida la Token Status List: el operador aporta `isRevoked`, que recibe `{ uri, idx }`.
- **Una credencial con `cnf` oculto detrás de una Disclosure** (lo que el RFC prohíbe al emisor) no se detecta: el titular podría no divulgarlo. Un despliegue que quiera cerrar eso exige `requireHolderBinding`.
- **El enrutador no es parte del framework.** Es una pieza de este ejemplo. Si varios operadores lo necesitan, la propuesta es llevarlo a `agent-mandates`.
