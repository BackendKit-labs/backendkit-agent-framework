# dalion-mandate-agent

Un agente de compras que actúa **bajo un apoderamiento**. La credencial dice **para quién** trabaja (el humano), **qué** puede hacer (comprar), **sobre qué** (una televisión) y **hasta qué importe** (1000 €). Dentro de eso compra solo; fuera de eso pregunta a una persona; sin un apoderamiento válido no hace nada y no pregunta a nadie. Cada llamada queda en un registro de auditoría encadenado con el apoderamiento bajo el que se ejecutó, y la cabeza de la cadena se firma.

> **El formato de la credencial de DALION es SUPUESTO.** Todavía no se conoce el real (SPEC-0043 §6; la F3 está bloqueada por eso). `src/dalion-assumed.ts` fija una forma inventada a partir de lo que se sabe del producto, para poder construir y probar ya el agente, la política, la auditoría y los casos de fallo. **No demuestra compatibilidad con DALION.** Cuando llegue el formato real, lo único que cambia es ese adaptador; los tests de `src/__tests__/` son el contrato que el nuevo adaptador tiene que seguir cumpliendo.

## La idea central: la credencial habla del dominio, no del código

La credencial **no dice qué herramientas puede ejecutar el agente**. Dice un **verbo** (`buy`), un **objeto** (`television`) y un **importe**. Qué herramienta de *este* agente realiza "comprar" lo declara **la propia herramienta**, en el campo de metadatos que el framework reserva para los clientes de gobernanza (`ToolDefinition.meta`), nunca la credencial:

```ts
defineTool({
  name: 'buy_supplies',
  destructive: true,
  meta: { capability: 'buy' },        // el verbo que realiza, en el vocabulario de la credencial
  // ...
});
// y objectOf: (args) => args.item     // sobre qué actúa una llamada, lo lee quien despliega el agente
```

Así, renombrar una herramienta no toca la credencial, y una herramienta que no declara ningún verbo **nunca** queda cubierta.

## Qué se supone del contenedor

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

## Qué decide el adaptador (y falla cerrado en cada punto)

Algoritmo y `typ` en lista blanca (`none` y los simétricos, fuera); emisor que el operador confía, con su clave; firma válida; la identidad del agente en `sub` es la que el operador registró para ese agente; vigencia; poderes bien formados, **sin comodín (ni de verbo ni de objeto) y sin (verbo, objeto) repetido**; un límite sin moneda se rechaza; y si la consulta de revocación falla, cuenta como revocado.

Responde **por llamada**: toma el verbo que realiza la herramienta llamada, busca el poder de ese verbo y de ese objeto, y devuelve un `Mandate` que cubre esa herramienta con el objeto y el límite de ese poder. La política (`mandatePolicy` de `agent-core`) no cambia. Una herramienta **de solo lectura** (consultar un precio) no necesita mandato: la decide la regla del propio framework (`defaultToolPolicy`). No se puede listar `defaultToolPolicy` junto a `mandatePolicy` (pide aprobación para toda herramienta destructiva y un `ask` gana a un `allow`, lo que anularía el mandato), así que el reparto se hace por el `readOnly` que declara la herramienta.

## Piezas

- `src/dalion-assumed.ts`: el adaptador (`dalionMandateVerifier`).
- `src/dalion-sim.ts`: un DALION de mentira que emite credenciales en ese formato y lleva una lista de revocados.
- `src/agent.ts`: el agente (`buildBuyerAgent`): motor real, `mandatePolicy`, aprobador, auditoría encadenada con puntos de control firmados.
- `src/__tests__/mandate-agent.test.ts`: 48 casos de extremo a extremo con el motor, la política y el verificador de `@backendkit-labs/agent-mandates` reales; solo el modelo (un guion) y DALION (el simulador) son de mentira.

```bash
npm install
npm test
```

## Qué demuestran los tests

- **Dentro** (comprar una televisión, hasta 1000 €): compra sin preguntar, la auditoría nombra el mandato (id, emisor, persona, hash de la credencial) y la credencial **no** aparece en el registro. Exactamente 1000 entra. Consultar un precio no necesita mandato. La credencial no contiene ningún nombre de herramienta.
- **Fuera** → **pregunta**: 1200 €, **otro objeto** (un portátil no es una televisión), una llamada que no dice qué compra, **otro verbo** (puede comprar, no firmar), una herramienta que no declara ningún verbo, otra moneda, un importe negativo, o un mandato de otra persona. Aprobado, compra; rechazado o sin aprobador, no.
- **Varios poderes**: cada objeto tiene su límite (portátil hasta 2500, televisión hasta 1000), y un poder sin objeto cubre el resto con el suyo.
- **Desacople**: otro vocabulario con el mismo agente solo cambia el verbo que declara la herramienta; una credencial que **nombra una herramienta** no concede nada.
- **Sin mandato válido** → **denegado, y el aprobador ni se consulta**. Cada caso se comprueba por **su motivo**: sin credencial, firmada por otro, emisor no confiable, caducada, aún no vigente, sin `exp`, emitida a otro agente, sin poderes, comodín de verbo u objeto, poder repetido, límite sin moneda o no numérico, objeto inválido, sin persona representada, otro tipo, divulgaciones selectivas, basura, payload editado, `alg: none`, confusión de algoritmo (HMAC firmado con la clave **pública**), origen que lanza, revocación que no responde y credencial revocada.
- **Revocación a mitad de camino**: revocada entre dos compras, la segunda no pasa.
- **Auditoría**: la cadena verifica, su cabeza está firmada, y editarla después se detecta.

Se comprobó que los tests tienen dientes: debilitaciones deliberadas del adaptador y de la política (sin comprobar la identidad del agente, sin firma, ignorando el objeto, usar el nombre de la herramienta como verbo, que el poder genérico gane al específico, comodín de objeto, revocación que falla abierta, sujeto tomado del que llama, exigir mandato también a las herramientas de solo lectura, o ignorar el mandato) rompen cada una al menos un test.

## Lo que NO hace (a propósito)

- **El límite es por operación, no acumulado.** Dos compras de 600 pasan bajo un mandato de 1000. Es lo que hace el verificador de referencia (SPEC-0043 §6, pregunta 2) y hay un test que lo documenta. Si la credencial real significa un **total**, el adaptador tiene que guardar lo gastado y ese test cambia con él.
- **El objeto se compara por texto exacto.** Si el modelo dice «TV» en vez de «television», **pregunta**: es seguro pero incómodo. La normalización (o un catálogo de objetos) es una decisión de quien despliega el agente.
- **No autentica a nadie.** `identity.userId` es lo que dice la aplicación; el mandato dice qué puede hacer el agente por esa persona.
- **No gestiona claves ni la fuente de revocación.** La lista de emisores confiables y dónde se consulta el estado son del operador.
- **Sin divulgación selectiva ni *key binding*:** una credencial que los trae se rechaza.
