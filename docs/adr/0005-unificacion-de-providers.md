# ADR-0005: Unificación de providers LLM

**Fecha:** 2026-10-21
**Estado:** Propuesto
**Spec:** [SPEC-0001 §7](../specs/SPEC-0001-agent-core-ola-1.md)

## Contexto
La implementación de `LLMProvider` para APIs compatibles con OpenAI está copiada y pegada:

- `packages/coding/src/providers/OpenAICompatibleProvider.ts` (160 líneas), `OllamaProvider.ts` (192) y `DeepSeekProvider.ts` (21, subclase).
- `packages/orchestrator-agent/src/provider.ts` (134), una cuarta copia.
- Unas veinte copias más en `packages/templates/*` y `packages/create-bk-agent/test-projects/*`.
- Además, `AnthropicProvider.ts` repite el mismo bucle de reintentos, `isRetryable`, `backoffMs` y `sleep`.

Cada copia diverge en detalles que hoy son defectos:
- Reintentos propios con el SDK en `maxRetries: 0`, en lugar de `@backendkit-labs/retry`, que el repo ya usa en `intent-detector`, `qa-service` y conectores. El significado de `maxRetries` varía (`while (attempt < maxRetries)` da 3 intentos, `<=` también 3 con otro default).
- Ollama no pide `stream_options.include_usage`: no reporta tokens, así que el presupuesto no ve sus llamadas.
- `orchestrator-agent` no envía `max_tokens` y descarta `callbacks.model` y `callbacks.signal` (no se puede abortar).
- `DeepSeekProvider` descarta `maxRetries`; la opción `thinking` existe en `OpenAICompatibleProviderOptions` pero no está expuesta en `OpenAICompatibleConfig` de `createCodingEngine`.
- Ollama solo reintenta 5xx y errores de conexión; los demás también 429.
- No hay ninguna prueba de providers en el repo, y el umbral de cobertura de `coding` es 60 %.

Las mejoras de provider de esta ola (salida estructurada, caché y razonamiento, métricas con caché) tendrían que repetirse en cada copia.

## Decisión
Extraer una base común y consumirla desde todos los paquetes.

1. **Ubicación:** un paquete nuevo `@backendkit-labs/agent-providers` (en `packages/providers`; nombre confirmado, libre en npm el 2026-10-21) con: `BaseStreamingProvider` (reintentos con `@backendkit-labs/retry`, política "no reintentar si ya se emitió contenido", ensamblado de tool calls, métricas y cierre), `OpenAICompatibleProvider`, `AnthropicProvider` y los presets `OllamaProvider` y `DeepSeekProvider`.
2. **Compatibilidad:** `@backendkit-labs/agent-coding` mantiene sus exports actuales como re-export del nuevo paquete; `orchestrator-agent` pasa a consumirlo y elimina `provider.ts`. Los templates (`packages/templates`) se actualizan en un PR aparte, una vez publicado el paquete, porque necesitan una versión publicada de la que depender; los `test-projects` de `create-bk-agent` son copias generadas y se regeneran con el script, sin editarlos a mano.
3. **Semántica unificada:** `maxAttempts` explícito, mismos criterios de reintento (429, 5xx, errores de red), uso siempre solicitado, `max_tokens`, `model` y `signal` siempre propagados, `thinking` y la configuración de `temperature` por preset (la regla de "reasoner → temperature 1" de `orchestrator-agent` se conserva como opción del preset).
4. **Inyección del cliente SDK** por constructor para poder probar con un doble, y una suite de pruebas de providers (reintentos, streaming, tool calls, métricas, abort).
5. **Orden:** esta unificación precede a ADR-0003; ADR-0004 solo toca Anthropic y puede avanzar en paralelo.

## Consecuencias
### Positivas
- Una sola implementación que mantener; las mejoras de provider se hacen una vez.
- Corrección de las divergencias anteriores, incluida la capacidad de abortar y de medir costo en Ollama y en `orchestrator-agent`.
- Primera cobertura de pruebas de providers.

### Negativas / trade-offs
- Un paquete nuevo que versionar y publicar, y un cambio transversal que toca `coding`, `orchestrator-agent` y, después, los templates.
- Riesgo de cambios de comportamiento sutiles (por ejemplo, el número real de reintentos); se mitigan con pruebas de caracterización antes de refactorizar.
- Los agentes con su propio `CuratorLLMProvider` (`curator-codex-agent`, `codex-context-agent-v2`) siguen fuera.

## Alternativas consideradas
- **Dejar la base dentro de `agent-coding`:** `orchestrator-agent` tendría que depender de un paquete de agentes de código; dirección de dependencias incorrecta.
- **Ponerla en `agent-core`:** añadiría los SDK de `openai` y `@anthropic-ai/sdk` a un núcleo que se quiere agnóstico del modelo.
- **No unificar y replicar cada mejora en cada copia:** descartada; ya hay divergencias reales y la ola 1 las multiplicaría.
