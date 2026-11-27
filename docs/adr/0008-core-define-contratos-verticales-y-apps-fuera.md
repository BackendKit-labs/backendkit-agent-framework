# ADR-0008: core define contratos; los verticales y las apps viven fuera

**Fecha:** 2026-11-14
**Estado:** Aceptado (2026-11-26; aplicado en SPEC-0014 a SPEC-0018)
**Spec:** [SPEC-0013](../specs/SPEC-0013-framework-como-libreria-hoja-de-ruta.md) (hoja de ruta), que se ejecuta en SPEC-0014 a SPEC-0018

## Contexto

`agent-core` nació como el motor de un asistente de coding en terminal, y el SDK creció a su alrededor. Hoy sirve para construir agentes de negocio (Steward), agentes de infraestructura (bk-platform) y agentes de coding (bk-coder-v2). Sin embargo, sus contratos centrales llevan dentro decisiones de esa primera app:

- `AgentEngineOptions` incluye `orchestrator`, `qaService`, `noQA` y `onQAReview`.
- `ExecutionContext` incluye `blockedCommands`, `additionalRoots` y `ProjectStoreData`, que son notas de sesión de desarrollo.
- `ApprovalGate` lleva cableadas las tools `write_file`, `edit_file` y `run_command`.
- Las rutas `~/.appName` están repartidas por `context`, `skills`, `reflection`, `trust` y `bootstrap`.

Además, un mismo concepto tiene varias implementaciones: workflow, política, memoria, auditoría y RAG.

El primer criterio que se propuso para podar fue contar quién usa cada pieza. Ese criterio se descarta. Una librería se juzga por lo que una pieza aporta a distintos tipos de agente, no por cuántos consumidores tiene en un momento dado.

## Decisión

1. **Cinco capas, con dependencias solo hacia abajo:**
   1. **Contratos de core:** engine, tools, tipos, puntos de extensión e interfaces de servicio.
   2. **Paquetes de capacidad:** MCP, protocol, web, otel, memory, rag, sandbox, testkit y document-extract.
   3. **Adaptadores:** providers, stores, fuentes de skills e instrucciones, y conectores.
   4. **Verticales:** coding y negocio.
   5. **Apps:** CLI de terminal, Hermes y la consola. (`orchestrator-agent` figuraba aquí; el 2026-11-16 se decidió absorberlo en las librerías, ver SPEC-0023 D9.)
2. **Core no conoce ningún dominio.** Ningún contrato de core nombra una tool concreta, un id de agente, un estado de un pipeline de dominio ni una ruta de un producto. Lo que hoy vive así en core sale a su vertical o a su app, y se engancha mediante los puntos de extensión de [SPEC-0014](../specs/SPEC-0014-puntos-de-extension-del-engine.md).
3. **Un contrato por concepto.** Workflow, política, memoria, auditoría y RAG tienen una sola interfaz en la capa más baja que los necesita. Las implementaciones son adaptadores de esa interfaz.
4. **Las decisiones se toman por capacidad, no por uso.** Una pieza se queda en core si es una primitiva genérica (otel, control, jobs, delegación, guardrails...), aunque hoy no tenga consumidores. Sale de core si está atada a un caso concreto, aunque se use mucho.
5. **Los hechos que declara una tool sustituyen a las listas de nombres.** Las reglas que hoy dependen de nombres de tools (aprobación, concurrencia) se expresan con hechos declarados como `readOnly` o `destructive`. Ver [SPEC-0011](../specs/SPEC-0011-mcp-server-tools-directas.md).

## Consecuencias

### Positivas
- Core se reduce en las 4,3k líneas de `orchestration`, las 4,6k de `reflection` y las piezas de la app de terminal.
- Un vertical nuevo (negocio, operaciones) se engancha por puntos de extensión, sin pedir campos nuevos en core.
- Hay un criterio verificable para cada PR futuro: ¿este contrato de core nombra algo de un dominio?

### Negativas / trade-offs
- Habrá un minor con ruptura (SPEC-0015): bk-coder-v2 cambia imports y opciones. Steward no se rompe, porque no usa las opciones de coding.
- Hay más paquetes o subpaths que versionar (vertical de coding, adaptadores).
- Riesgo de abstraer de más. Para evitarlo, cada interfaz nueva debe tener dos implementaciones reales que la validen, normalmente el vertical de coding y Steward. Si no, no se crea.

## Alternativas consideradas
- **Podar por uso:** quitar lo que hoy no importa nadie. Se rechaza: elimina primitivas valiosas (otel, control, jobs, delegación) y deja dentro la lógica de coding, que se usa mucho pero está acoplada.
- **Dejar core como está y añadir solo hooks:** se rechaza como estado final. Los hooks son el paso 1, pero mientras las opciones de coding sigan en los contratos, cada vertical nuevo pedirá las suyas.
- **Un paquete por capacidad desde ya** (core mínimo y decenas de paquetes): se rechaza por ahora. Multiplica la carga de versionado sin un consumidor que lo pida. Las capacidades se separan cuando su dependencia lo justifica (como `otel` o `sandbox`).
