# SPEC-0029: adaptador de modelos del AI SDK de Vercel a `LLMProvider`

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). El AI SDK de Vercel documenta unos 50 providers (Google, Vertex, Bedrock, Azure, Mistral, Cohere, Groq, Perplexity...). Nosotros ofrecemos OpenAI-compatible y Anthropic.
**Depende de:** nada. Es aditivo en `agent-providers`.
**Tipo de cambio:** aditivo; un punto de entrada nuevo y una dependencia opcional.
**Objetivo:** que cualquier modelo que el AI SDK sepa llamar se pueda usar como `LLMProvider` del framework, sin escribir un provider por proveedor.

## 1. De dónde se parte

Verificado el 2026-11-17:

- El contrato es `LLMProvider` (`packages/core/src/types/index.ts`): `chat(messages, tools, callbacks, options?)` más `capabilities?: { structuredOutput }` y `modelId?`. Las respuestas llegan por `LLMStreamCallbacks`: `onChunk`, `onToolCall`, `onDone`, `onError`, `onMetrics` (tokens, caché), `onReasoning`, `signal` y `model` (cambio de modelo por llamada). `ChatOptions` trae `responseFormat` (json_schema) y `toolChoice`.
- `agent-providers` tiene `BaseStreamingProvider` (reintento y streaming compartidos), `OpenAICompatibleProvider` (OpenAI, DeepSeek, Ollama), `AnthropicProvider` y `withRetry`. Depende de `openai` y `@anthropic-ai/sdk`.
- Los mensajes llevan `raw?: unknown` para datos opacos que deben volver intactos (el bloque `thinking` de Anthropic).

## 2. Evidencia en la competencia

Vercel `ai`, commit `486e08f`: el clon **no trajo las fuentes**, solo documentación. De `AGENTS.md`: `packages/provider` es la especificación de la interfaz (`@ai-sdk/provider`) y `packages/<provider>` las implementaciones; `content/providers/01-ai-sdk-providers` lista 51 entradas. **La forma exacta del tipo `LanguageModel` y de sus partes de stream no está verificada**: es lo primero que hace F0.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Paquete nuevo o punto de entrada? | **Subruta de `agent-providers`:** `@backendkit-labs/agent-providers/ai-sdk`, con `@ai-sdk/provider` como dependencia **opcional**. Quien no lo usa no lo instala. |
| D2 | ¿Qué API? | `fromAiSdk(model, opts?)` devuelve un `LLMProvider`. `model` es un `LanguageModel` del AI SDK (por ejemplo `google('gemini-2.5-pro')`). |
| D3 | ¿Quién reintenta? | **Nosotros**, con `withRetry`/`BaseStreamingProvider`, y el modelo del AI SDK se invoca con sus reintentos propios a 0, para no multiplicarlos. Los errores se clasifican con `isTransient`. |
| D4 | ¿Cómo se traducen las herramientas? | Las `ToolDefinition` ya llevan un esquema zod 4; se convierte con el mismo `z.toJSONSchema` que usa core y se entrega como herramientas de función del AI SDK **sin `execute`**: el engine, no el SDK, ejecuta (y aplica política y aprobación). |
| D5 | ¿`capabilities.structuredOutput`? | **Conservador: `none`** hasta que F0 confirme qué modelos del SDK aplican un esquema; con `opts.structuredOutput` el integrador lo declara. Una promesa falsa de `native` rompe la validación de core. |
| D6 | ¿Razonamiento, uso y caché? | Se mapean a `onReasoning` y `onMetrics` (con `cacheReadTokens`/`cacheWriteTokens` si el proveedor los reporta). `LLMMessage.raw` conserva la parte opaca de cada mensaje del asistente para devolverla al mismo proveedor. |

## 4. Diseño

```ts
import { google } from '@ai-sdk/google';
import { fromAiSdk } from '@backendkit-labs/agent-providers/ai-sdk';

const engine = createBaseEngine({
  providers: { gemini: fromAiSdk(google('gemini-2.5-pro')) },
  defaultProvider: 'gemini',
  /* ... */
});
```

- Los mensajes `system`, `user`, `assistant` (con `tool_calls`) y `tool` se mapean al prompt del SDK; una llamada de tool queda emparejada con su resultado por `tool_call_id`.
- La señal de aborto de `LLMStreamCallbacks.signal` se pasa al modelo del SDK.
- `ChatOptions.toolChoice` y `responseFormat` se pasan cuando el modelo los admite; si no, se ignoran y se avisa una vez.

## 5. Fases

- **F0. Fijar el contrato real.** Instalar `@ai-sdk/provider` y `ai` en un directorio temporal, leer los tipos de `LanguageModel` (versión actual) y de las partes de stream, y escribir en esta spec la tabla de correspondencia exacta. Decidir qué versiones del SDK se soportan (un rango de peer).
- **F1. Texto y herramientas.** Prueba con el `MockLanguageModel` que el propio SDK entrega para pruebas (`ai/test`, a verificar en F0): un modelo simulado que pide una tool y luego responde hace correr el engine de principio a fin.
- **F2. Aborto, errores y reintento.** Prueba: abortar corta el stream; un error transitorio se reintenta una vez; uno permanente llega a `onError`.
- **F3. Uso, caché y razonamiento.** Prueba: `onMetrics` recibe los tokens del modelo simulado; con una parte de razonamiento, `onReasoning` recibe el texto.
- **F4. Salida estructurada** (según F0).
- **F5. Documentación y ejemplo** con un modelo real, para que lo ejecute el usuario con su clave (no se prueba en CI).

## 6. Criterios de aceptación

- Un agente existente cambia de `OpenAICompatibleProvider` a `fromAiSdk(...)` con solo cambiar la línea del provider, y su suite offline sigue pasando.
- Una `ToolDefinition` nunca se ejecuta dentro del SDK: toda llamada pasa por las puertas del engine.

## 7. Riesgos y fuera de alcance

- El AI SDK cambia de versión de interfaz con frecuencia; se fija un rango y se prueba contra el mínimo y el máximo.
- Dos capas de reintento y de normalización de errores pueden contradecirse: D3.
- Fuera de alcance: exponer nuestros providers como modelos del AI SDK (la dirección inversa), imágenes, audio y vídeo.
