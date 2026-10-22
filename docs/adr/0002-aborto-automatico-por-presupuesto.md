# ADR-0002: Aborto automático por presupuesto

**Fecha:** 2026-10-21
**Estado:** Aceptado
**Implementado en:** agent-core 0.26.0, agent-coding 0.22.0 (PR #50)
**Spec:** [SPEC-0001 §4](../specs/SPEC-0001-agent-core-ola-1.md)

## Contexto
`CostTracker` (`packages/core/src/observability/CostTracker.ts:28-52`) ya calcula el costo por ejecución y por día y llama a `onBudgetExceeded`, pero eso es todo: el motor sigue gastando. El JSDoc de `createBaseEngine` sugiere abortar a mano con `engine.abort()` dentro del callback.

Problemas observados:
- `onBudgetExceeded` se llama en **cada** evento de métricas una vez superado el límite, no una sola vez.
- El `else if` entre `perRun` y `perDay` oculta el límite diario si el de ejecución también se superó.
- El estado diario es solo memoria: se pierde al reiniciar el proceso.
- Si no hay precios configurados, el costo es 0 y el presupuesto nunca se dispara, sin ningún aviso.
- `createCodingEngine` no expone la opción `observability`; el presupuesto solo es accesible desde `createBaseEngine`.
- Los sub-agentes (`runAgentInternal`) no consultan `aborted` ni reciben `signal`, así que un aborto no los detiene.
- Las métricas de Anthropic llegan una vez al final de la llamada: el aborto ocurre después del gasto, no lo previene (sobrecoste máximo: una llamada).

## Decisión
Añadir un aborto automático opcional, idempotente y que alcance a los sub-agentes.

1. **Opción:** `abortOnBudget?: boolean` (por defecto `false`) en `BaseEngineOptions`, y la misma en `CodingEngineOptions`, que además expone `observability`.
2. **Disparo único:** `CostTracker` llama `onBudgetExceeded` **una sola vez por límite y por ejecución** (`perDay`: una vez por día). Se reinician en `onRunStart()` y al cambiar de día. Se reportan los dos límites si ambos se superan.
3. **Aborto:** `createBaseEngine` envuelve `onBudgetExceeded` con una referencia tardía al engine: llama `engine.abort()`, emite un evento nuevo `budget_exceeded` (con `BudgetUsage`) y después invoca el callback del usuario.
4. **Comprobación previa:** al inicio de cada iteración del bucle, si el costo acumulado de la ejecución ya superó el límite, no se hace otra llamada al LLM.
5. **Sub-agentes:** `runAgentInternal` comprueba `this.aborted` en cada iteración y recibe `signal`.
6. **Avisos de configuración:** si hay `budget` y no hay precios ni el modelo está en `MODEL_PRICING`, el engine emite un evento `system` de nivel `warn` al crearse. Lo mismo si se configura `budget.perDay`: el gasto diario no se persiste y en procesos de vida corta (CLI) empieza en cero, así que el aviso lo dice explícitamente. La persistencia queda para una ola posterior.
7. **Fuera de alcance:** persistir el gasto diario y cancelar herramientas en ejecución (requiere `ExecutionContext.signal`).

## Consecuencias
### Positivas
- Un tope de gasto real, no solo informativo.
- El callback deja de dispararse en bucle, lo que hacía inseguro cualquier acción dentro de él.
- Los sub-agentes también se detienen.

### Negativas / trade-offs
- **Cambio de comportamiento:** quien ya usa `onBudgetExceeded` pasa de recibir N llamadas a recibir una. Se documenta como corrección.
- El nuevo evento `budget_exceeded` obliga a revisar los transportes y los `switch` exhaustivos de `AgentEvent` (por ejemplo en `packages/web`).
- El gasto puede superar el límite en una llamada completa antes del aborto.
- El presupuesto diario sigue sin sobrevivir a un reinicio.

## Alternativas consideradas
- **Abortar siempre al superar el presupuesto:** descartada; cambiaría el comportamiento de quien lo usa solo para alertar.
- **Mantener solo el callback (estado actual):** descartada; deja a cada agente reimplementar el aborto y sin protección contra la repetición.
- **Predecir el costo antes de llamar:** descartada por ahora; requiere estimar tokens de salida.
- **Reutilizar el evento `error`:** descartada; marcaría la ejecución como errónea en `ObservabilityManager`.
