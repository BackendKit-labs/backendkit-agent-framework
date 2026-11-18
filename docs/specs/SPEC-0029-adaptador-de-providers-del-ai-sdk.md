# SPEC-0029: adaptador de modelos del AI SDK de Vercel a `LLMProvider`

**Fecha:** 2026-11-17
**Estado:** Borrador. **F0 hecha (2026-11-18)**: contrato verificado, ver §8; D1, D3 y D5 cambian. **F1 hecha (2026-11-18)**, junto con F2 y F3 que salieron en el mismo código, ver §9. F4 y F5 sin hacer.
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

## 8. F0: el contrato real (2026-11-18)

Verificado instalando `ai` 7.0.176, `@ai-sdk/provider` 4.0.39, `@ai-sdk/google` 4.0.122 y `@ai-sdk/openai` 4.0.121 en un directorio aparte y leyendo sus tipos.

**Lo que se sabía mal o faltaba**

- **Hay tres versiones de interfaz vivas.** `ai` define `LanguageModel = string | LanguageModelV4 | LanguageModelV3 | LanguageModelV2`. Las líneas `ai-v5` y `ai-v6` de npm son V2 y V3; la actual (`latest`) es V4. Los paquetes de proveedor actuales (`@ai-sdk/google`, `@ai-sdk/openai`) devuelven modelos `specificationVersion: 'v4'`. Un adaptador que solo entienda V4 deja fuera a quien no ha migrado.
- **`doStream` no reintenta.** `LanguageModelV4CallOptions` no tiene `maxRetries`: el reintento vive en `ai` (`generateText`), no en el modelo. D3 se simplifica: no hay nada que poner a 0, reintentamos nosotros.
- **El tipo `LanguageModel` incluye un `string`** (id global de proveedor del AI SDK Gateway). El adaptador exige un objeto modelo y rechaza el string con un error claro.

**Contrato V4** (`doStream(options)` devuelve `{ stream: ReadableStream<Part> }`; `doGenerate` existe pero no se usa)

| Nuestro `LLMProvider.chat` | Opción V4 |
|---|---|
| mensajes `system` / `user` / `assistant` / `tool` | `prompt`: `system` con `content: string`; `user` y `assistant` con arreglos de partes (`text`, `reasoning`, `tool-call`); `tool` con partes `tool-result` |
| una llamada de tool del asistente | parte `tool-call { toolCallId, toolName, input: unknown }` (objeto, no string) |
| su resultado | parte `tool-result { toolCallId, toolName, output: { type: 'text', value } \| { type: 'json', value } \| { type: 'execution-denied', ... } }` |
| `ToolDefinition` | `tools: [{ type: 'function', name, description, inputSchema: JSONSchema7 }]`, sin `execute` |
| `ChatOptions.toolChoice` | `{ type: 'auto' \| 'none' \| 'required' }` o `{ type: 'tool', toolName }` |
| `ChatOptions.responseFormat` | `{ type: 'json', schema, name?, description? }` |
| `callbacks.signal` | `abortSignal` |
| temperatura, tokens máximos | `temperature`, `maxOutputTokens`, `topP`, `stopSequences`, `seed` |

**Partes del stream → callbacks:** `text-delta { delta }` → `onChunk`; `reasoning-delta { delta }` → `onReasoning`; `tool-call { toolCallId, toolName, input: string JSON }` → `onToolCall` (llega completa; `tool-input-start/delta/end` son solo progreso y se ignoran); `finish { usage, finishReason }` → `onMetrics` y `onDone`; `error { error }` → `onError`; `stream-start` (avisos), `response-metadata`, `ping`, `raw`, `source`, `file` se ignoran. `finishReason` es `{ unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other', raw }` en V3 y V4, y un string en V2.

**Uso:** V3 y V4: `inputTokens { total, noCache, cacheRead, cacheWrite }` y `outputTokens { total, text, reasoning }`. V2: números planos `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens?`, `cachedInputTokens?` (sin `cacheWrite`).

**Pruebas:** `ai/test` exporta `MockLanguageModelV4` y `MockLanguageModelV3`, no `V2`: el caso V2 se prueba con un modelo escrito a mano.

**Decisiones que cambian**

| # | Antes | Ahora |
|---|---|---|
| D1 | `@ai-sdk/provider` como dependencia opcional | **Ninguna dependencia.** El adaptador declara una interfaz estructural mínima (`doStream`, `specificationVersion`, `modelId`, `provider`) y normaliza V2/V3/V4 por `specificationVersion`. Así no hay rango de peer que mantener ni versión del SDK que fijar. Las pruebas usan `ai` como devDependency. |
| D3 | el AI SDK invocado con sus reintentos a 0 | `doStream` no reintenta: reintentamos nosotros con `withRetry`, sin más. |
| D5 | `capabilities.structuredOutput = none` hasta F0 | Se mantiene `none` por defecto: `responseFormat` con esquema existe en el contrato, pero que el modelo lo aplique depende del proveedor, y F0 no puede probarlo sin clave. Con `opts.structuredOutput` el integrador lo declara; F4 lo cablea. |

**Qué queda sin comprobar:** el comportamiento real de un proveedor (nadie probó aún un `google(...)` en vivo), que es F5 y lo ejecuta el usuario con su clave.

## 9. F1 (con F2 y F3): `fromAiSdk` (2026-11-18)

`packages/providers/src/AiSdkProvider.ts`, exportado desde la entrada principal de `agent-providers` (no hace falta una subruta `/ai-sdk`: sin dependencia, no cuesta nada a quien no lo usa). `fromAiSdk(model, opts)` devuelve un `AiSdkProvider extends BaseStreamingProvider`, así que hereda el reintento, el no reintentar tras salida o aborto, y la clasificación de errores. Opciones: `structuredOutput`, `temperature`, `maxOutputTokens`, `providerOptions`, y los de reintento.

- **Sin dependencia del SDK:** el parámetro es una interfaz estructural (`AiSdkModelLike`). Rechaza un `string` (id del Gateway) y una versión de interfaz que no sea v2, v3 o v4, con un mensaje claro.
- **Las tools salen sin `execute`:** solo `type`, `name`, `description` e `inputSchema`. El engine las ejecuta, con su política y su aprobación.
- **Cubre F2 y F3 por el camino:** aborto (la señal va como `abortSignal`), reintento de un 503 y no de un 401, un `error` del stream (tras salida no se reintenta), uso con tokens de caché (v3/v4 anidado, v2 plano) y razonamiento a `onReasoning`.

**Pruebas:** 16 en `AiSdkProvider.test.ts` con un modelo escrito a mano que reproduce las partes de §8 (83 en el paquete, todas verdes). Además, **contra los modelos simulados reales del SDK** (`MockLanguageModelV4` y `MockLanguageModelV3` de `ai/test`, `ai` 7.0.176), con un script aparte que no está en el repo: texto, llamada a tool completa y uso con caché llegan igual por las dos versiones, y las tools salen con las cuatro claves esperadas. `ai` no se añadió como devDependency: es solo ESM, pide Node 22 y arrastraría un árbol grande de dependencias a un paquete que declara Node 20.

**Sin comprobar:** una corrida del engine completo (el motor pide una tool, la ejecuta y vuelve al modelo) con este provider; el provider se prueba aislado. Un modelo real (`google(...)`), que es F5 y lo ejecuta el usuario con su clave. `ChatOptions.responseFormat` se envía pero no hay prueba de que un proveedor concreto lo aplique (F4). No se transportan `raw` ni los bloques opacos de razonamiento entre turnos (D6): si un proveedor los exige de vuelta, fallará en la segunda vuelta de una tool.
