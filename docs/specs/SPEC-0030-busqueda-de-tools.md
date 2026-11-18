# SPEC-0030: búsqueda de tools con carga diferida

**Fecha:** 2026-11-17
**Estado:** Borrador. **F0 a F4 hechas (2026-11-18)**, ver §8. F5 (buscador enchufable y documentación) sin hacer.
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
| D4 | ¿Cuánto dura una tool descubierta? | **Hasta el fin de la ejecución (`run`)**, en orden estable (se añaden al final de la lista, no se reordenan). Así el prefijo del prompt solo crece y se aprovecha la caché hasta ese punto. |
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

**Pruebas:** 20 (17 del engine, con 30 tools diferidas y un proveedor que registra la lista de cada llamada, y 11 unitarias del buscador; 1025 verdes en core). Dos pruebas de TTL de `FileRunJournal` (`journal-conformance` y `when-claim-cost`) fallan a veces cuando se corre toda la suite en paralelo en Windows, y pasan solas: no tienen relación con este cambio.

**Sin comprobar:** un modelo real que decida buscar (los modelos débiles pueden no hacerlo, §7); el efecto en la caché de prompts de un proveedor real; el buscador enchufable y la documentación (F5).
