# SPEC-0030: búsqueda de tools con carga diferida

**Fecha:** 2026-11-17
**Estado:** Borrador. **F0 a F5 hechas (2026-11-18)**, ver §8 y §9; el modo `message` que evita cortar la caché, §11.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). El AI SDK de Vercel ofrece `toolSearch()` con `deferLoading`: el modelo encuentra las tools que necesita sin que todas sus definiciones ocupen el contexto desde el principio.
**Depende de:** nada. Aditivo en `agent-core`.
**Tipo de cambio:** aditivo. Sin `deferLoading` en ninguna tool, el engine se comporta igual que hoy.
**Objetivo:** que un agente con decenas o cientos de tools (conectores MCP, departamentos enteros) no pague en cada llamada el coste de describírselas todas al modelo, ni se confunda eligiendo entre ellas.

## 1. De dónde se parte

Verificado en `packages/core/src` el 2026-11-17:

- En cada llamada al modelo el engine envía **todas** las tools permitidas del agente: `getToolsForAgent(profile)` (`engine/AgentEngine.ts`, ~l. 1053) toma `ToolRegistry.getForAgent(profile.allowedTools)`, y lo llaman las rutas de `chat` de ~l. 1110, 1133 y 1417.
- Una llamada de tool se comprueba después, en orden: `allowedTools`, sandbox, guardrails de argumentos, política y aprobación (~l. 1562-1599). Eso **no cambia**.
- Las tools MCP del cliente se registran junto a las propias, así que un servidor MCP con 40 tools suma 40 definiciones al contexto.
- `ToolDefinition` lleva metadatos declarados (`readOnly`, `destructive`, `idempotent`, `openWorld`, `meta`), no un campo de visibilidad.
- `ContextManager` controla el historial, **no** las definiciones de tools ni el prompt del sistema (sus comentarios lo dicen: "the system prompt and tool schemas are not counted").

## 2. Evidencia en la competencia

Vercel `ai`, commit `486e08f` (solo documentación: `content/docs/03-ai-sdk-core/19-tool-search.mdx`): se registran tools con `deferLoading: true`; `toolSearch()` busca por nombre y descripción, con un callback `search` propio y un límite `maxResults`; las tools encontradas quedan disponibles **en el siguiente paso del modelo**. Mencionan un modo "con caché preservada", señal de que añadir tools en mitad de una conversación cambia el prefijo y puede invalidar la caché de prompts (D4).

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo se marca una tool diferida? | **`defer: true` en `defineTool`** (y en `ToolDefinition`), o por agente: `AgentProfile.deferTools: ['crm_*']` con comodines, para diferir las de un servidor MCP sin tocarlas. |
| D2 | ¿Cómo las encuentra el modelo? | Una tool incorporada, **`tool_search({ query })`**, que el engine añade a un agente con alguna tool diferida. Devuelve nombre y descripción de las mejores coincidencias (`maxResults`, por defecto 5) y las deja visibles. |
| D3 | ¿Cómo busca? | Por defecto, **puntuación por palabras sobre nombre y descripción** (sin dependencias ni modelo). Enchufable: `search(query, candidates) => ToolDefinition[]`, para quien quiera embeddings. |
| D4 | ¿Cuánto dura una tool descubierta? | **Hasta el fin de la ejecución (`run`)**, en orden estable (se añaden al final de la lista, no se reordenan). Se pensó para que el prefijo del prompt solo creciera; §10 mide que la caché igualmente se corta en cada cambio de la lista. |
| D5 | ¿La búsqueda puede saltarse el control? | **No.** Solo busca entre tools que el agente **ya tiene permitidas** (`allowedTools` y política `deny` aplicados antes). Una tool oculta por política no aparece en los resultados. Encontrar una tool no la autoriza: la llamada pasa por todas las puertas de siempre. |
| D6 | ¿Se registra? | Sí: cada búsqueda es un evento (`tool_search`) con la consulta y los nombres devueltos, y llega a la auditoría. |

## 4. Diseño

```ts
const crm = defineTool({ name: 'crm_find_contact', description: '...', defer: true, /* ... */ });

const engine = createBaseEngine({
  tools: [...ownTools, ...crmTools],            // 40 tools, todas con defer
  agents: [{ id: 'sales', allowedTools: ['crm_*', 'tool_search'], deferTools: ['crm_*'], /* ... */ }],
});
```

- El engine envía al modelo las tools no diferidas más `tool_search` y las ya descubiertas en esta ejecución.
- Si el modelo llama a una tool diferida que aún no descubrió, la llamada **falla con un mensaje claro** ("usa tool_search primero") y no se ejecuta: el modelo conoce esa tool solo por su nombre, y se busca el error más barato, no adivinar el esquema.
- El estado de lo descubierto vive en la ejecución, no en el agente: otra conversación empieza de cero.

## 5. Fases

- **F0. Verificar.** Releer `getToolsForAgent` y sus tres llamadores; comprobar si `delegatesTo` y `ask_agent` entran en la lista de tools del modelo por la misma ruta; medir cuántos tokens ocupan 40 definiciones reales (las de `mcp-connectors`) para fijar el criterio de éxito de la mejora.
- **F1. `defer` y `tool_search` con búsqueda por palabras.** Prueba con `scriptedProvider`: con 30 tools diferidas, la primera llamada al modelo recibe solo `tool_search` y las no diferidas (`provider.calls` lo demuestra); el modelo busca, la siguiente llamada trae la tool encontrada, y la ejecuta.
- **F2. Gobierno (D5).** Prueba: una tool diferida denegada por política no aparece en los resultados; una que el modelo llama sin haberla descubierto falla sin ejecutarse.
- **F3. `deferTools` con comodines** en el perfil. Prueba con un servidor MCP simulado de 10 tools.
- **F4. Eventos y auditoría (D6).** Prueba: el `HashChainAuditSink` recibe la búsqueda.
- **F5. Buscador enchufable (D3)** y documentación en la página de tools.

## 6. Criterios de aceptación

- Con 30 tools diferidas, el número de tokens de definiciones de tools de la primera llamada baja en el orden que F0 midió (se fija el objetivo allí).
- Ningún resultado de `tool_search` incluye una tool que el agente no podría llamar.
- Un agente sin tools diferidas no recibe `tool_search` y su prompt no cambia por un solo carácter.

## 7. Riesgos y fuera de alcance

- Un modelo débil puede no buscar. Se documenta cuándo conviene diferir (muchas tools, descripciones largas) y cuándo no (pocas tools).
- Añadir tools a mitad de una conversación puede invalidar la caché de prompts del proveedor; D4 lo limita a "solo crece".
- Fuera de alcance: carga diferida de **esquemas** (enviar solo el nombre y pedir el esquema después) y el modo de código de SPEC-0035.

## 8. F0-F4: lo que se verificó y se hizo (2026-11-18)

**F0, lo que el código dice**

- `getToolsForAgent` (`AgentEngine.ts`) lo usan el bucle principal y el de sub-agentes: ambos pasan por la misma función, y `ask_agent` entra por ahí también. Un solo punto de cambio.
- **`allowedTools` no admite comodines** (`ToolRegistry.getForAgent` busca por nombre exacto, y la puerta de la llamada hace `includes`). El ejemplo de §4 (`allowedTools: ['crm_*', ...]`) era incorrecto: los comodines viven solo en `deferTools`, y `allowedTools` lleva los nombres.
- El criterio de éxito (§6) se mide así: los 18 tools reales de `mcp-connectors` ocupan, **solo con nombre, descripción y nombres de argumentos**, unos 640 tokens (≈ 35 por tool); con el esquema JSON completo son varias veces más. Para 30 tools diferidas la primera llamada lleva `tool_search` (~100 tokens) en lugar de las 30 definiciones: **la lista de tools baja en más de un 80 %**; se fija ese objetivo.

**Lo implementado** (`engine/toolSearch.ts` y el cableado en `AgentEngine`)

- `ToolDefinition.defer` y `defineTool({ defer: true })`; `AgentProfile.deferTools` con nombre exacto o `prefijo*` (D1).
- `tool_search({ query })` se ofrece solo a un agente con alguna tool diferida; no necesita estar en su `allowedTools`. Puntúa por palabras: una palabra del nombre pesa 4 (2 si es parte), una de la descripción 1; hasta 5 resultados (D2, D3).
- La lista que ve el modelo es: las no diferidas, `ask_agent`, `tool_search` y, **al final y en el orden en que se encontraron**, las descubiertas (D4). El estado se borra al empezar cada `run` y es por agente.
- **Gobierno (D5):** la búsqueda solo mira tools de `allowedTools`, y no ofrece las que el sandbox rechaza o que una política deniega (evaluada con argumentos vacíos; una denegación que dependa de los argumentos se aplica al llamar). Llamar a una tool diferida que no se encontró falla con "usa tool_search" y no se ejecuta; una aprobación ya guardada (`runApproved`) no lo exige. Encontrar no autoriza: aprobación, política y guardrails se aplican igual (hay una prueba con una tool destructiva rechazada por el aprobador).
- **Auditoría (D6):** `tool_search` pasa por la misma ruta que cualquier tool, así que lo registran el audit y el transporte (`tool_result`), con la consulta como argumentos. No se añadió un tipo de evento nuevo: lo que habría llevado (consulta y nombres) ya está en el evento de la llamada y en su resultado.

**Pruebas:** 20 (14 del engine, con 30 tools diferidas y un proveedor que registra la lista de cada llamada, y 6 unitarias del buscador; 1025 verdes en core). Dos pruebas de TTL de `FileRunJournal` (`journal-conformance` y `when-claim-cost`) fallan a veces cuando se corre toda la suite en paralelo en Windows, y pasan solas: no tienen relación con este cambio.

**Sin comprobar:** los modelos débiles (§7: solo se probó DeepSeek v4-flash, §10); un proveedor con caché explícita (Anthropic) o con otro formato de caché.

## 9. F5: buscador enchufable y documentación (2026-11-18)

`createBaseEngine({ toolSearch: { search, maxResults } })`. `search(query, candidates)` (síncrono o asíncrono) recibe como candidatas **solo** las tools diferidas que el agente puede llamar y que ni la política ni la sandbox deniegan; lo que devuelva y no sea candidata se descarta, así que un buscador propio no puede hacer visible lo que el gobierno ocultó (D5). `maxResults` (por defecto 5) vale también para la búsqueda por palabras. 3 pruebas nuevas (17 en el archivo): el buscador propio se usa y se respeta su orden y límite; una candidata denegada por política y una tool ajena que devuelve no entran; búsqueda asíncrona y `maxResults` solo.
**Documentación:** sección "Many tools: let the model search" en `concepts/engine-and-tools`.
**Sin comprobar:** un buscador real con embeddings (la interfaz se probó con funciones de prueba); un modelo real que decida buscar y el efecto en la caché de un proveedor real (como en §8). Sin publicar: va en el próximo release de `agent-core`.

## 10. Prueba en vivo con DeepSeek (2026-11-18)

`deepseek-v4-flash` por el adaptador del AI SDK, 40 tools de un CRM inventado (10 dominios por 4 verbos, unos 2 800 tokens de definiciones), con `deferTools: ['crm_*']` frente a las mismas tools listadas. El system prompt **no** menciona `tool_search`. Los tokens salen de `onMetrics` (los cacheados, de `cacheReadTokens`); "equivalente" cuenta un token cacheado a una décima de uno normal.

| Tarea | Llamadas con diferidas | Entrada (todas / cacheada) | Equivalente (diferidas / listadas) |
|---|---|---|---|
| Buscar un envío por id | `tool_search`, `crm_find_shipment` | 2 345 / 1 152 (frente a 6 133 / 5 760) | n/m (primera prueba) |
| Dos consultas (factura y reembolso) | `tool_search` ×2, y cada consulta dos veces | 4 811 / 3 328 (frente a 6 127 / 5 760) | **1 816 / 943** (peor) |
| Crear un presupuesto de un producto | `tool_search`, `crm_create_quote` | 2 218 / 1 152 (frente a 9 181 / 8 576) | **1 181 / 1 463** (mejor) |
| `2+2` (sin tool) | ninguna | 376 / 128 (frente a 2 969 / 2 816) | **261 / 435** (mejor) |

**Lo que se comprobó**
1. **El modelo busca solo.** En las 4 tareas con tool, sin pista en el prompt, llamó a `tool_search` y luego a la tool correcta; la descripción de `tool_search` basta. En la tarea sin tool no buscó. Es una muestra de 4 con un modelo; no dice nada de modelos débiles.
2. **Los tokens de entrada bajan** entre un 45 % y un 88 %.
3. **El dinero no baja siempre.** Cada búsqueda cambia la lista de tools, y la caché del proveedor se corta en el primer cambio: la lectura de caché cae a 128 tokens en el paso siguiente a la búsqueda, y el historial se paga de nuevo. Con 40 tools (2 800 tokens) y caché, el resultado fue mejor en dos tareas y **peor en una** (la del modelo que repitió llamadas tras buscar). La premisa de D4 ("el prefijo solo crece y se aprovecha la caché") es cierta solo hasta la lista de tools: el historial va **después**.

**Consecuencias**
- La ventaja es segura cuando la lista es grande (cientos de tools, servidores MCP) o cuando el límite es el contexto, no el precio. Con pocas decenas de tools y caché, conviene medir antes de diferir. La documentación lo dice así.
- Una mejora posible, **sin hacer**: no cortar la caché en cada búsqueda, p. ej. enviando las tools descubiertas en el mensaje y no en la lista; cambia el contrato con el modelo y exige medirlo.
- **Sin comprobar:** Anthropic (caché explícita con `cache_control`, donde el efecto puede ser distinto), Gemini, y modelos débiles.

## 11. Modo `message`: la lista de tools no cambia (2026-11-18)

§10 midió que cada búsqueda cambia la lista de tools y corta la caché del proveedor. `createBaseEngine({ toolSearch: { mode: 'message' } })` (por defecto sigue `'list'`) deja la lista fija: la respuesta de `tool_search` trae nombre, descripción y los parámetros (JSON Schema) de lo encontrado, y el modelo llama a la tool por su nombre. El motor la ejecuta porque fue encontrada; una tool no encontrada sigue fallando sin ejecutarse, y la política y la sandbox siguen mandando (`tool_search` no ofrece lo que deniegan). 4 pruebas nuevas (27 entre los dos archivos): la lista no cambia en ninguna petición, la respuesta lleva los parámetros y la tool corre, lo no encontrado o denegado no corre, y el modo por defecto no cambia.

**Medido con DeepSeek** (`deepseek-v4-flash`, 40 tools, 3 tareas por 3 repeticiones = 9 corridas por variante; equivalente = tokens cacheados a una décima):

| Variante | Entrada media | Coste equivalente medio | Llamadas medias | Fallos |
|---|---|---|---|---|
| Las 40 tools listadas | 7 129 | 1 126 | 1,7 | 0 |
| Diferidas, modo `list` | 3 153 | 1 234 (+10 %) | 3,3 | 0 |
| Diferidas, modo `message` | 2 568 | **1 136** | 3,1 | 0 |

**Lectura honesta:** el modo `message` quita la penalización de la caché (de +10 % a empate con listarlo todo) y baja un 64 % los tokens de entrada, sin un solo fallo; DeepSeek acepta y ejecuta llamadas a una tool que no está en su lista. Pero **con 40 tools no es más barato que listarlas**: gana quien tenga cientos de tools o el límite en el contexto, no en el precio. Es una mejora modesta y por eso es opt-in.

**Sin comprobar:** Anthropic y OpenAI. Si un proveedor rechaza, o el modelo no llama bien, una tool que no está en su lista, el modo `message` no sirve con él; DeepSeek sí. El historial con una llamada a una tool que no está en la lista también depende del proveedor. Otros modelos más débiles: solo se probó uno.
