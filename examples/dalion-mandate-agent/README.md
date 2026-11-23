# dalion-mandate-agent

Un agente de compras que actúa **bajo un apoderamiento**: dentro de los límites que le firmaron compra solo; fuera de ellos pregunta a una persona; sin un apoderamiento válido no hace nada y no pregunta a nadie. Cada llamada queda en un registro de auditoría encadenado con el apoderamiento bajo el que se ejecutó, y la cabeza de la cadena se firma.

> **El formato de la credencial de DALION es SUPUESTO.** Todavía no se conoce el real (SPEC-0043 §6; la F3 está bloqueada por eso). `src/dalion-assumed.ts` fija una forma inventada a partir de lo que se sabe del producto, para poder construir y probar ya el agente, la política, la auditoría y los casos de fallo. **No demuestra compatibilidad con DALION.** Cuando llegue el formato real, lo único que cambia es ese adaptador; los tests de `src/__tests__/` son el contrato que el nuevo adaptador tiene que seguir cumpliendo.

## Qué se supone

Un JWT con forma de SD-JWT VC, firmado por el emisor (`iss`):

| Campo | Qué es |
|---|---|
| `sub` | La identidad **no humana del agente** (`did:dalion:agent:buyer-01`), no la de la persona |
| `represents.id` | Para quién trabaja el agente |
| `powers[]` | Un poder por herramienta: `{ action, max?: { value, currency }, resources? }`, cada uno con **su propio** límite |
| `status.id` | Lo que usa la consulta de revocación |
| `jti`, `nbf`, `exp` | Id y vigencia. **`exp` es obligatorio**: un poder sin fin no se acepta |
| `vct` | Nombra este formato supuesto |

## Qué decide el adaptador (y falla cerrado en cada punto)

Algoritmo y `typ` en lista blanca (`none` y los simétricos, fuera); emisor que el operador confía, con su clave; firma válida; la identidad del agente en `sub` es la que el operador registró para ese agente (una credencial emitida a otro agente no sirve); vigencia; poderes bien formados, **sin comodín y sin acción repetida**; un límite sin moneda se rechaza; y si la consulta de revocación falla, cuenta como revocado.

Como DALION pone un límite **por acción**, el adaptador responde **por llamada**: devuelve un `Mandate` que cubre la herramienta que se está llamando, con el límite de esa herramienta. La política (`mandatePolicy` de `agent-core`) no cambia.

## Piezas

- `src/dalion-assumed.ts`: el adaptador (`dalionMandateVerifier`).
- `src/dalion-sim.ts`: un DALION de mentira que emite credenciales en ese formato y lleva una lista de revocados.
- `src/agent.ts`: el agente (`buildBuyerAgent`): motor real, `mandatePolicy`, aprobador, auditoría encadenada con puntos de control firmados.
- `src/__tests__/mandate-agent.test.ts`: 36 casos de extremo a extremo con el motor, la política y el verificador de `@backendkit-labs/agent-mandates` reales; solo el modelo (un guion) y DALION (el simulador) son de mentira.

```bash
npm install
npm test
```

## Qué demuestran los tests

- **Dentro del límite** (hasta 500 EUR): compra sin preguntar, la auditoría nombra el mandato (id, emisor, persona, hash de la credencial) y la credencial **no** aparece en el registro. Exactamente en el límite entra.
- **Fuera**: más de 500, otra moneda, un importe negativo, una herramienta que no figura en los poderes, o un mandato de otra persona → **pregunta**. Aprobado, compra; rechazado o sin aprobador, no.
- **Sin mandato válido** → **denegado, y el aprobador ni se consulta** (uno que diría que sí no llega a decidir). Cada caso se comprueba por **su motivo**, no solo por el resultado: sin credencial, firmada por otro, emisor no confiable, caducada, aún no vigente, sin `exp`, emitida a otro agente, sin poderes, comodín, acción repetida, límite sin moneda o no numérico, otro tipo, divulgaciones selectivas, basura, payload editado, `alg: none`, confusión de algoritmo (HMAC firmado con la clave **pública**), origen de la credencial que lanza, revocación que no responde y credencial revocada.
- **Revocación a mitad de camino**: revocada entre dos compras, la segunda no pasa.
- **Auditoría**: la cadena verifica, su cabeza está firmada, y editarla después se detecta.

Se probó también que los tests tienen dientes: quitar la comprobación de la identidad del agente, la de la firma, la del comodín, hacer que la revocación falle abierta o tomar el sujeto del que llama en vez de la credencial rompe al menos un test cada vez.

## Lo que NO hace (a propósito)

- **El límite es por operación, no acumulado.** Dos compras de 400 pasan bajo un mandato de 500. Es lo que hace el verificador de referencia (SPEC-0043 §6, pregunta 2) y hay un test que lo documenta para que nadie lo dé por hecho. Si la credencial real significa un **total**, el adaptador tiene que guardar lo gastado y ese test cambia con él.
- **No autentica a nadie.** `identity.userId` es lo que dice la aplicación; el mandato dice qué puede hacer el agente por esa persona. Que la persona sea quien dice ser es de quien emitió la credencial.
- **No gestiona claves ni la fuente de revocación.** La lista de emisores confiables y dónde se consulta el estado son del operador.
- **Sin divulgación selectiva ni *key binding*:** una credencial que los trae se rechaza.
