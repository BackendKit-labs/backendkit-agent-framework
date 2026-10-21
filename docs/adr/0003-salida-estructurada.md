# ADR-0003: Salida estructurada

**Fecha:** 2026-10-21
**Estado:** Propuesto
**Spec:** [SPEC-0001 §5](../specs/SPEC-0001-agent-core-ola-1.md)
**Depende de:** [ADR-0005](0005-unificacion-de-providers.md)

## Contexto
Hoy todo JSON que pedimos al LLM depende del prompt más un parseo tolerante:
- `intent-detector.ts:219-249` pide `Respond ONLY with JSON: {"action":"<type>"}` y extrae con la regex `/"action"\s*:\s*"([\w-]+)"/`.
- `orchestrator-agent/src/planner.ts` pide "Output ONLY valid JSON" y busca un bloque ```json o `{...}`.
- `analyzer.ts` y `documentation-curator.ts` de `curator-codex-agent` hacen lo mismo con limpieza de fences y validación con zod, y un archivo entero se pierde si el JSON no valida (ya nos pasó con títulos largos).

La causa es el contrato: `LLMProvider.chat(messages, tools, callbacks)` (`core/src/types/index.ts:174-176`) no tiene canal de opciones por llamada, y `LLMChatClient.chat` es solo texto. Los providers no envían `response_format`, `output_config` ni `tool_choice` distinto de `auto` (Anthropic ninguno). El SDK de Anthropic instalado (0.98.0) soporta `output_config.format` con `json_schema` y `tool_choice` forzado; las APIs compatibles con OpenAI soportan `response_format`.

## Decisión
Añadir salida estructurada de forma compatible hacia atrás, con degradación explícita según el provider.

1. **Opciones por llamada:** cuarto parámetro opcional `options?: ChatOptions` en `LLMProvider.chat`, con `responseFormat?: { type: 'json_schema'; name: string; schema: JSONSchema; strict?: boolean }` y `toolChoice?: 'auto' | 'none' | 'required' | { name: string }`. Los providers que no lo conozcan lo ignoran.
2. **Capacidad declarada:** `LLMProvider.capabilities?: { structuredOutput: 'native' | 'json_object' | 'none' }`.
3. **API del engine:** `engine.generateObject<T>(prompt, schema: ZodType<T>, opts?)`. Convierte el esquema zod con el mismo helper que ya usa `defineTool` (se extrae a una función reutilizable), pide el formato nativo, valida con zod y, si falla, reintenta **una vez** devolviendo al modelo el error de validación. Si vuelve a fallar lanza un error tipado `StructuredOutputError` con la respuesta cruda.
4. **Mapeo por provider:**
   - Anthropic: `output_config.format` con `json_schema`; respaldo: una herramienta única `respond` con `tool_choice` forzado.
   - OpenAI-compatible: `response_format: { type: 'json_schema', json_schema: {...} }`.
   - DeepSeek, que solo ofrece `json_object`: `response_format: { type: 'json_object' }` y el esquema incluido en el prompt; la validación zod sigue siendo obligatoria.
   - Ollama: `format` / `response_format` si el servidor lo soporta; si no, comportamiento `json_object`.
5. **Primer consumidor:** `intent-detector` deja de usar regex y usa `generateObject` con un esquema de enum. El resto de consumidores (planner, curadores) migran después, en sus propios cambios.

## Consecuencias
### Positivas
- JSON válido garantizado por el provider cuando es posible, y un único punto de validación y reintento cuando no.
- Se elimina un tipo de fallo que hoy descarta trabajo completo (archivos enteros, planes).
- Los esquemas zod que ya usamos para las herramientas sirven también para la salida.

### Negativas / trade-offs
- Una pequeña ampliación del contrato público de `LLMProvider` (compatible porque es opcional).
- Cada provider necesita su mapeo y sus pruebas; por eso depende de la unificación de providers (ADR-0005).
- La garantía varía por provider (`native` frente a `json_object`).
- Los esquemas muy complejos pueden no estar soportados por el modo estricto de algún provider.

## Alternativas consideradas
- **Mantener prompt + regex (estado actual):** descartada; es la fuente de los fallos observados.
- **Herramienta única forzada en todos los providers:** descartada como mecanismo general; funciona, pero consume el canal de herramientas y mezcla semánticas. Queda como respaldo de Anthropic.
- **Dejar la validación a cada consumidor:** descartada; duplica el reintento y los mensajes de error.
