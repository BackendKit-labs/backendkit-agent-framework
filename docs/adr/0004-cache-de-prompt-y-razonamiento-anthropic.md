# ADR-0004: Caché de prompt y razonamiento extendido en Anthropic

**Fecha:** 2026-10-21
**Estado:** Aceptado
**Implementado en:** agent-core 0.27.0, agent-providers 0.2.0, agent-coding 0.23.0 (PR #53)
**Spec:** [SPEC-0001 §6](../specs/SPEC-0001-agent-core-ola-1.md)

## Contexto
`AnthropicProvider` (`packages/coding/src/providers/AnthropicProvider.ts`) manda el system prompt como una sola cadena (`system: string`, línea 159) y no usa `cache_control`, `thinking` ni `tool_choice`. En un bucle de agente el system prompt, las definiciones de herramientas y el historial se reenvían enteros en cada iteración, así que es el caso típico donde la caché de prompt reduce costo y latencia. El SDK instalado (0.98.0) soporta `cache_control` en bloques de sistema, herramientas y mensajes, `thinking: { type: 'enabled', budget_tokens }` y los campos de uso `cache_read_input_tokens` y `cache_creation_input_tokens`.

Limitaciones del contrato actual:
- `LLMMessage.content` es `string | null` (`core/src/types/index.ts:140-145`): no puede llevar bloques con `cache_control` ni los bloques `thinking` con su firma, que la API exige reenviar intactos cuando el turno continúa con herramientas.
- `onMetrics(inputTokens, outputTokens)` (`types/index.ts:159`) no informa de tokens de caché. En Anthropic `input_tokens` **excluye** los tokens de caché, así que con caché activa el costo y el contexto visto quedarían subestimados.
- `CostTracker` y `MODEL_PRICING` (`observability/types.ts:87-94`) solo conocen precio de entrada y de salida.
- Con thinking activo la API exige `temperature` 1 o ausente; hoy se envía siempre (por defecto 0.0).
- El parser ignora `thinking_delta`, `signature_delta` y los bloques `thinking`/`redacted_thinking`.

## Decisión
Soportar ambas capacidades en el provider de Anthropic, desactivadas por defecto.

1. **Configuración por provider/perfil:** `cache?: 'none' | 'system' | 'system+tools' | 'auto'` (por defecto `none`) y `cacheTtl?: '5m' | '1h'`; `thinking?: { budgetTokens: number }` (mínimo 1024, menor que `max_tokens`). Se pasan en el constructor y, cuando exista, por `ChatOptions` (ADR-0003).
2. **Caché:** el system prompt se envía como bloques con `cache_control` en el último bloque; con `system+tools`, también en la última definición de herramienta; con `auto`, además un punto de caché móvil en el último mensaje. El orden de bloques se mantiene estable para no invalidar el prefijo.
3. **Mensajes:** `LLMMessage` gana un campo opcional `raw?: unknown`, un payload opaco del provider que conserva los bloques originales del asistente (incluido `thinking` con firma). El provider lo reenvía tal cual en el siguiente turno; los demás providers lo ignoran. `HistoryManager` lo persiste con el resto del mensaje.
4. **Thinking:** el provider omite `temperature` cuando thinking está activo. Los deltas de razonamiento se entregan solo por un callback opcional `onReasoning?(delta)`. El evento `reasoning` hacia el transporte se difiere hasta que `web-ui` tenga un componente colapsable, para no ampliar `AgentEvent` en esta ola (cada evento nuevo obliga a revisar los transportes).
5. **Métricas:** `onMetrics(input, output, usage?)` con `usage = { cacheReadTokens, cacheWriteTokens }`; el evento `metrics` gana esos campos opcionales.
6. **Costo:** `CostTrackerConfig` añade `cacheReadPricePerMToken` y `cacheWritePricePerMToken`; `MODEL_PRICING` pasa a incluirlos (lectura ≈ 0,1× el precio de entrada, escritura ≈ 1,25× con TTL de 5 minutos y ≈ 2× con 1 hora). Los valores de `MODEL_PRICING` se revisan contra la tarifa vigente antes de publicar.

## Consecuencias
### Positivas
- Reducción de costo y latencia en bucles largos, sin cambios para quien no lo active.
- Razonamiento extendido disponible para tareas difíciles (planificación, depuración).
- El costo reportado deja de subestimar cuando hay caché.

### Negativas / trade-offs
- `LLMMessage.raw` es un campo opaco que acopla el historial al formato de Anthropic; el historial persistido crece.
- Un cambio de orden o contenido del prefijo invalida la caché; hay que documentar qué es estable.
- Las escrituras en caché cuestan más que una lectura normal: con conversaciones cortas puede salir más caro.
- El razonamiento aumenta tokens de salida y latencia.

## Alternativas consideradas
- **Dejar los puntos de caché a la API sin marcar bloques:** no da control sobre qué prefijo es estable ni sobre el TTL, y no hay forma de medir el efecto.
- **Solo caché del system prompt, sin herramientas ni historial:** más simple, pero deja el mayor ahorro sin usar; queda como el modo `system`.
- **No soportar thinking:** descartada; es una capacidad de primera clase en el provider, y sin preservar bloques el modo no es utilizable en bucles con herramientas.
- **Ampliar `LLMMessage.content` a bloques tipados:** más limpio, pero rompe a todos los providers y consumidores; se reevaluará si más providers lo necesitan.
