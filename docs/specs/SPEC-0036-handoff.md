# SPEC-0036: traspaso de control entre agentes (handoff)

**Fecha:** 2026-11-17
**Estado:** Borrador. **Con criterio de entrada: no se empieza hasta que un caso real lo pida** (§3). Sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). OpenAI Agents JS trata el traspaso como una pieza principal: un agente cede la conversación a otro, que sigue desde ahí.
**Depende de:** la delegación actual (`ask_agent`, `delegatesTo`, `maxDelegationDepth`) y [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (política y auditoría).
**Tipo de cambio:** aditivo.
**Objetivo:** que un agente de recepción pueda **pasar la conversación** a un especialista, que responde directamente al usuario, en lugar de que el primero le pida un resultado y lo repita.

## 1. De dónde se parte

Verificado en `packages/core/src` el 2026-11-17:

- **Delegación:** un agente con `delegatesTo` llama a `ask_agent`; el engine ejecuta al otro agente y **devuelve su respuesta al que preguntó**, que sigue siendo quien habla con el usuario. Tiene límite de profundidad (`maxDelegationDepth`) y una cadena de delegación registrada (`delegation/DelegationBus.ts`); la política ve la cadena. Las llamadas a `ask_agent` de un mismo turno pueden correr en paralelo.
- **Cambio de agente manual:** `engine.switchAgent(agentId)` (`AgentEngine.ts` ~l. 989) cambia el agente activo, pero lo decide el código del integrador, no el modelo, y no queda en la cadena de delegación.
- El historial es de la sesión, compartido por el agente activo.
- La única mención de `handoff` en el código de producción es un nombre en el pipeline de coding (`task-context.ts`), no una función del engine.

## 2. Evidencia en la competencia

OpenAI Agents JS (commit `90a6b52`, `packages/agents-core/src/handoff.ts`): un traspaso se expone al modelo como una tool `transfer_to_<agente>`; admite `inputFilter` (qué parte del historial recibe el agente nuevo), `isEnabled` (activarlo según contexto), `toolNameOverride` y `onHandoff` (un callback al traspasar).

## 3. Criterio de entrada

La delegación más los flows cubren casi todo: un agente de recepción puede delegar y contestar él. El traspaso aporta algo solo si se cumple esto:

1. El especialista debe **hablar directamente con el usuario** a partir de ahí, varios turnos, con su propio prompt y sus propias tools.
2. Que el primer agente siga en medio (preguntar y repetir) es un coste o una pérdida de calidad medibles.

Sin un caso así, no se construye. Hasta entonces, `switchAgent` desde el código del integrador resuelve el caso manual.

## 4. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo lo ve el modelo? | Una tool `transfer_to_<agente>` por cada destino de `AgentProfile.handoffTo`. |
| D2 | ¿Qué historial recibe el destino? | **Filtrado por defecto:** los mensajes de usuario y los textos del asistente, **sin los resultados de tools del agente anterior**, que pueden contener datos que el destino no debería ver. `inputFilter` permite ampliarlo. Es el punto de gobierno más delicado. |
| D3 | ¿Qué gobierno aplica? | El traspaso es **una llamada como cualquier otra:** `allowedTools`, política (`allow`/`ask`/`deny`) y auditoría. Entra en la cadena de delegación con `via: 'handoff'`. Un traspaso denegado se explica al modelo. |
| D4 | ¿Y las tools del agente nuevo? | **Las suyas, no las del anterior.** Sus `allowedTools` mandan desde ese momento. |
| D5 | ¿Se puede volver? | Solo si el destino tiene un `handoffTo` hacia el origen. **Con tope de traspasos por ejecución** (por defecto 3) para evitar ciclos. |
| D6 | ¿Qué pasa con el presupuesto y los eventos? | El coste y los eventos siguen acumulándose en la misma ejecución; el transporte recibe un evento `handoff` con origen y destino. |

## 5. Fases (solo si §3 se cumple)

- **F0. Confirmar el caso** y comprobar si `switchAgent` más un prompt de recepción lo cubre con menos.
- **F1. `handoffTo` y la tool `transfer_to_*`** con historial filtrado (D2). Prueba con `scriptedProvider`: el destino responde, y `provider.calls` demuestra que no recibió los resultados de tools del primero.
- **F2. Política y cadena (D3).** Prueba: una política que deniega el traspaso lo bloquea y el modelo ve la razón; la cadena registra `handoff`.
- **F3. Tope y ciclos (D5).** Prueba: dos agentes que se pasan la conversación se detienen al tercer traspaso con un error claro.
- **F4. Documentación,** junto con delegación y flows, con una tabla de cuándo usar cada una.

## 6. Criterios de aceptación

- El agente destino nunca ve resultados de tools del origen sin un `inputFilter` explícito.
- Todo traspaso queda en la auditoría con origen, destino y quién lo decidió.

## 7. Fuera de alcance

Traspasos entre procesos o a agentes remotos (eso es `agent-protocol`), y traspasos que cambien de tenant (están prohibidos).
