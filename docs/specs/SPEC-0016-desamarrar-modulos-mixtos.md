# SPEC-0016: desamarrar los módulos mixtos

**Fecha:** 2026-11-14
**Estado:** Borrador
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (hook `systemPrompt`). Puede ir en el mismo minor que [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md).
**Tipo de cambio:** con ruptura en los imports de la app de terminal; aditivo para quien use `createBaseEngine` sin esas funciones.
**Objetivo:** que en core quede la idea genérica de cada módulo mixto (instrucciones por capas, skills, comandos, agentes como datos) y que la estructura de archivos de la app de terminal (`~/.appName/...`) pase a ser un adaptador.

## 1. Módulos y separación (verificado el 2026-11-14)

| Módulo | Se queda en core (contrato) | Sale (adaptador o app) |
|---|---|---|
| `context` (451 líneas; `pipeline.ts` usa `appName` en todas las etapas) | `InstructionSource { load(ctx): Promise<InstructionLayer[]> }` y la composición por capas con saneo (el saneo de SPEC-0009 sigue en core) | `fileInstructionSource({ appName, cwd })`: las etapas `instructions`, `project`, `session`, `manifest` y `lessons` con `AGENT.md`, `USER.md` y `~/.appName` |
| `skills` (1.165) | `Skill`, `SkillSource { list(): Promise<Skill[]> }`, `SkillActivator` por disparadores y `SkillRegistry` | detección de stack (`STACK_INDICATORS`) como adaptador de coding; fuentes GitHub, skills.sh, Obsidian y local como adaptadores; `SkillManager` (instalar y desinstalar) a la app |
| `commands` (1.120) | `SlashCommandRegistry` (134) | `builtin.ts` (982: `/help`, `/agents`, `/skills`, `/status`, `/trust`, `/iteration`, `/workspace`, `/checkpoint`, `/plugin`) a la app de terminal |
| `agent-discovery` (475) | `AgentSource { list(): Promise<AgentProfile[]> }` y el parser de `agent.yaml`/`agent.json` | `globalAgentsDir`/`projectAgentsDir` (`~/.appName/agents`) y `RemoteAgentRegistry` como adaptadores |
| `workspace` (250), `checkpoint` (218), `trust` (150), `bootstrap` (372) | — | app de terminal. `trust` sigue aplicándose: la app lo implementa como un `InstructionSource` y un `SkillSource` que filtran por proyecto de confianza (ADR-0006) |
| `shared/utils/project-key.ts`, `git.ts` | `atomicWrite` | `project-key` y `git` a la app |

**Dónde va "la app de terminal":** hoy no existe como paquete. Propuesta: `agent-coding/cli`, que es donde ya vive `TerminalTransport` y el REPL que consume estos comandos. **Decisión del usuario**, ligada a SPEC-0015 §2.

## 2. Cómo se enganchan

- `createBaseEngine({ instructions?: InstructionSource[], skills?: SkillSource[], agents?: AgentSource[] })`. Lo que hoy se carga de disco por defecto pasa a declararse.
- Las capas de instrucciones entran al system prompt mediante el hook `systemPrompt` (SPEC-0014), no con código propio en `buildSystemPrompt`.
- `createCodingEngine` registra los adaptadores de archivos, así que para el usuario de la CLI no cambia nada.

## 3. Fases

- **F1. Instrucciones y agentes como fuentes.** `InstructionSource` y `AgentSource` en core, adaptadores de archivos al vertical y la app. Test: el system prompt de la CLI es idéntico byte a byte antes y después (snapshot).
- **F2. Skills.** `SkillSource` y activación genérica en core; detección de stack y fuentes remotas como adaptadores. Test: las mismas skills se activan con la misma entrada.
- **F3. App de terminal.** Comandos integrados, `workspace`, `checkpoint`, `trust`, `bootstrap`, `project-key` y `git` salen de core. `orchestrator-agent` queda clasificado como app (se mueve a bk-platform cuando migre a zod 4).

## 4. Criterios de aceptación

- `core/src` no contiene `os.homedir()` ni plantillas `.${appName}`. Se comprueba con un test que hace grep sobre el código fuente.
- Un agente de negocio se construye con `createBaseEngine` sin tocar el disco si no se le pasan fuentes de archivos.
- La CLI funciona igual: snapshot del prompt y suite de comandos.

## 5. Fuera de alcance

- Rediseñar las skills o los comandos: solo se separan.
- La memoria (`agent-memory`, `ProjectStoreData`): SPEC-0015 F4 y SPEC-0017 F4.
