# ADR-0006: Confianza del workspace para la capa de proyecto

**Fecha:** 2026-10-24
**Estado:** Aceptado
**Implementado en:** C1 de SPEC-0009 (agent-core, agent-coding; sin publicar)
**Spec:** [SPEC-0009 §C1](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md)

## Contexto
`createCodingEngine` carga agentes con `AgentLoader.load({ cwd: opts.workingDir ?? process.cwd() })` (`packages/coding/src/index.ts:424`), y `SkillLoader.loadProject(cwd)` carga skills desde `{cwd}/.bk-agent/skills/`. Las dos son capas **de proyecto**: su contenido viene del repositorio que el usuario abre, no de quien opera el agente.

Lo verificado en el código (2026-10-24):
- **No hay ningún control de confianza.** `TrustConfig` y `BK_TRUSTED_SOURCES` solo gobiernan `SkillManager.install(source)`, es decir, instalar desde una fuente remota. Cargar lo que ya está en el repositorio no pasa por ahí.
- **El proyecto gana por id** (`project > global > builtin`, `AgentLoader.ts:151-155`). Un repositorio puede traer `.bk-agent/agents/general.json` y reemplazar el orquestador builtin, con su `systemPrompt`, sus `allowedTools`, su `delegatesTo` y sin `blockedCommands`. `readAgentDir` copia el JSON entero al perfil (`{ ...def, systemPrompt, source }`).
- **Qué NO puede hacer** (comprobado): definir un proveedor propio. Los proveedores y sus `baseUrl` y claves solo se leen de `~/.bk-agent/config.json` (`ConfigLoader.ts:103-105`), así que un repositorio no puede redirigir la conversación ni las claves a un servidor suyo. `secrets: { X: { env } }` sí puede pedir una variable del host, pero solo lo leen las herramientas de `aval-tools`, y ninguna devuelve el valor al modelo.
- Lo que acota el daño hoy: `write_file`, `edit_file` y `run_command` piden aprobación, el sandbox confina, y la allowlist de `run_command` filtra binarios.

Resultado: control del prompt y de las herramientas del agente desde el contenido del repositorio. Severidad **media**: no hay una vía de fuga de credenciales, pero es la misma clase de riesgo que ejecutar los hooks o la configuración de un repositorio no confiable.

## Decisión
Un único concepto de **confianza del workspace**, con una sola puerta para toda la capa de proyecto.

1. La capa de proyecto (agentes, skills y cualquier capa de proyecto futura, como una configuración por repositorio) **solo se carga si la ruta del proyecto está confiada**.
2. La confianza es una decisión explícita del usuario, por ruta real (`realpath`, normalizada): una entrada en `~/.{appName}/trusted-projects.json`, o `BK_TRUST_PROJECT=1` para entornos controlados (CI, contenedores).
3. Si el proyecto **no** está confiado, se omite la capa de proyecto y se **avisa**, listando qué se omitió y cómo confiar. El agente arranca con builtin y global.
4. **El mecanismo de personalización no cambia.** La precedencia `project > global > builtin` y los overrides `{id}.md` (`AgentLoader.ts:134`, `applyPromptOverrides`) siguen funcionando, para proyectos confiados.
5. Confiar es una acción del usuario, nunca una consecuencia de otra cosa: ni un agente ni una skill pueden confiar un proyecto.

## Consecuencias
### Positivas
- Cierra el vector con un solo mecanismo en lugar de uno por tipo de contenido.
- Abrir un repositorio ajeno ya no carga su prompt ni sus herramientas sin que el usuario lo decida.
- El comodín `delegatesTo: ['*']` (SPEC-0009 §C2) deja de alcanzar agentes de proyecto no confiados.

### Negativas / trade-offs
- **Cambio de comportamiento:** quien ya tiene `.bk-agent/agents` o `.bk-agent/skills` en sus repositorios debe confiar cada proyecto una vez. Es un cambio de default deliberado; se documenta en el CHANGELOG.
- Un archivo más en el directorio global del usuario, y un comando o flujo para confiar.
- La confianza es por ruta: mover o clonar el repositorio a otra ruta pide confiarlo de nuevo.

## Alternativas consideradas
- **Impedir que el proyecto pise ids builtin.** Rechazada: rompe una función documentada (personalizar un builtin con un `.md` del mismo id) y no cubre agentes con ids nuevos ni las skills.
- **Restringir qué campos puede fijar un agente de proyecto** (por ejemplo, vetarle `allowedTools`). Rechazada: la lista de campos peligrosos crece con cada campo nuevo y el control real es la confianza en el origen, no el campo.
- **No hacer nada y apoyarse en las aprobaciones.** Rechazada: las aprobaciones acotan las acciones, pero no el prompt, y "approve all" las apaga.
- **Confianza por origen git o por hash del contenido.** Diferida: más precisa (sobrevive a mover el repositorio, detecta cambios), pero exige decidir qué se hashea y cuándo se revoca. La entrada por ruta permite migrar a ella sin cambiar la puerta.
