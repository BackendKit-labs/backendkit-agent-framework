# SPEC-0035: code mode (el modelo escribe código que llama tools en un sandbox)

**Fecha:** 2026-11-17
**Estado:** Borrador. **Decisión previa abierta (§3):** si encaja con los principios del framework. Sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). El AI SDK de Vercel ofrece `@ai-sdk/code-mode`: el modelo escribe JavaScript o TypeScript que llama a las tools, y el código corre en un sandbox QuickJS aislado.
**Depende de:** `agent-sandbox`, [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (política, aprobación y auditoría), opcionalmente [SPEC-0030](SPEC-0030-busqueda-de-tools.md).
**Tipo de cambio:** aditivo y opt-in; un módulo nuevo.
**Objetivo:** que el modelo pueda **orquestar varias tools con lógica** (llamarlas a la vez, combinar y filtrar resultados grandes antes de que lleguen al contexto, usar bucles y condiciones) en una sola llamada, sin perder el control del framework sobre cada llamada.

## 1. De dónde se parte

Verificado el 2026-11-17:

- Hoy cada llamada de tool es **una vuelta del bucle**: el modelo pide, el engine comprueba (`allowedTools`, sandbox, guardrails de argumentos, política y aprobación) y ejecuta, y el resultado vuelve al modelo (`AgentEngine.ts` ~l. 1562-1599). Las llamadas de solo lectura de un turno pueden correr en paralelo (`maxParallelTools`).
- `agent-sandbox` confina **lo que los agentes ejecutan** (modos, presets, un punto de política, backend docker), no un intérprete de código del modelo.
- El framework se define por una idea: **el gobierno está fuera del modelo** (la web, página de governance). Cada llamada pasa por una política y deja un evento de auditoría.

## 2. Evidencia en la competencia

Vercel `ai`, commit `486e08f` (documentación `content/docs/03-ai-sdk-core/18-code-mode.mdx`): el modelo escribe código que llama a las tools del SDK; corre en QuickJS aislado y devuelve un resultado serializable en JSON. Permite llamar tools independientes en paralelo, transformar y combinar resultados, **filtrar respuestas grandes antes de devolverlas al modelo** y usar el control de flujo de JavaScript. La documentación lleva un aviso (`<Note type="warning">`) sobre el riesgo. La búsqueda de tools del mismo SDK tiene un modo "con caché preservada" que se apoya en code mode.

## 3. Decisión previa: ¿encaja?

El riesgo no es técnico, es de principio: **código escrito por el modelo que llama a tools** es la vía más fácil de eludir la política si cada llamada interna no pasa por las mismas puertas. Esta spec solo continúa si se cumplen **a la vez**:

1. **Cada llamada interna a una tool pasa por el engine completo** (`allowedTools`, política, aprobación, auditoría, presupuesto), con el mismo `principal` y una marca `via: 'code-mode'` en la cadena. El código no ve las tools como funciones sueltas: ve proxies que vuelven al engine.
2. El intérprete **no tiene acceso a nada más** (ni red, ni archivos, ni `process`, ni reloj real salvo lo que se le dé).
3. Hay topes duros de **tiempo, memoria y número de llamadas** por ejecución.

Si cualquiera de las tres no se puede garantizar con el intérprete elegido, se descarta y esta spec queda como registro.

## 4. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué intérprete? | **QuickJS en WASM** (como Vercel), por ser pequeño y sin acceso al sistema por diseño. Alternativa: el backend docker de `agent-sandbox`, más pesado y lento de arrancar. F0 compara ambos. |
| D2 | ¿Qué tools se exponen al código? | **Solo las `readOnly` por defecto.** Las `destructive` se exponen únicamente con una opción explícita y **cada llamada pide aprobación como siempre** (el código se detiene hasta que alguien decide). |
| D3 | ¿Cómo se ofrece al modelo? | Una tool incorporada, `run_code({ code })`, declarada `destructive: false` pero con `alwaysAsk` cuando el código toque tools que lo requieran. La descripción del tipo de las tools expuestas se genera desde sus esquemas. |
| D4 | ¿Qué devuelve? | El valor de la última expresión, serializado en JSON y **cortado a un máximo** (como `maxOutputChars` del servidor de tools). |
| D5 | ¿Presupuesto? | Tope de llamadas internas, de tiempo y de memoria; al superarlo la ejecución termina con un error claro, no con un cuelgue. |
| D6 | ¿Auditoría? | Un evento por llamada interna, enlazado a la `run_code` que la originó, además del evento de la propia `run_code` (con el hash del código). |

## 5. Fases (solo si §3 se cumple)

- **F0. Prototipo y examen de §3.** Una prueba de concepto fuera del framework con QuickJS: ¿se puede garantizar el punto 1 (proxies al engine) y el 2 (sin acceso)? Probar a escapar: `process`, `require`, `fetch`, `import()`, `globalThis`. Documentar cada intento y el resultado. **Si algo escapa, parar.**
- **F1. Intérprete aislado con topes (D5)** y sin tools. Prueba: un bucle infinito termina por tiempo; una asignación enorme, por memoria.
- **F2. Proxies de tools `readOnly` que vuelven al engine (D2, D6).** Prueba: cada llamada interna aparece en la auditoría con su principal; una tool denegada por política falla dentro del código con el mismo mensaje.
- **F3. Llamadas en paralelo** con `Promise.all` dentro del código, respetando `maxParallelTools`.
- **F4. `destructive` con aprobación.** Prueba: el código queda detenido en la llamada hasta que alguien aprueba; sin aprobador, falla cerrado.
- **F5. Documentación** con los casos de uso y el modelo de amenazas.

## 6. Criterios de aceptación

- No existe ningún camino desde el código del modelo a una tool que no pase por la política del engine.
- Todo intento de escape de F0 está documentado y bloqueado, con una prueba que lo repite.
- Sin la opción activada, el engine no cambia.

## 7. Riesgos y fuera de alcance

Es la spec con **más riesgo** de las doce: una sola brecha anularía la promesa del framework. Por eso F0 es un examen, no un trámite. Fuera de alcance: ejecutar código en otros lenguajes, dar red o disco al código, y que el modelo defina tools nuevas.
