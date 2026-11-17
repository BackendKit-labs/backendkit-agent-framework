# Specs

Especificaciones de cambios que afectan a varios paquetes. Cada spec enlaza los ADR que justifican sus decisiones; el ADR explica el porqué, el spec explica el qué y el cómo.

| Spec | Título | Estado |
|---|---|---|
| [SPEC-0001](SPEC-0001-agent-core-ola-1.md) | Ola 1 de capacidades de agent-core | Implementado (core 0.27) |
| [SPEC-0002](SPEC-0002-agent-core-ola-3a.md) | Ola 3a: señal y plazo por tool, reintento tras desbordamiento, credenciales por referencia, jobs | Borrador |
| [SPEC-0003](https://github.com/BackendKit-labs/bk-platform/blob/master/docs/hermes/SPEC-0003-hermes-plano-de-control.md) | Hermes: plano de control de agentes | Borrador |
| [SPEC-0004](SPEC-0004-agent-session.md) | agent-session: log de sesión orientado a eventos | Borrador |
| [SPEC-0005](SPEC-0005-agent-subagents-y-agent-acp.md) | agent-subagents y agent-acp | Borrador |
| [SPEC-0006](SPEC-0006-agent-sandbox.md) | agent-sandbox: confinamiento y permisos | Borrador |
| [SPEC-0007](SPEC-0007-agent-testkit-y-agent-autonomy.md) | agent-testkit y agent-autonomy | Borrador |
| [SPEC-0008](https://github.com/BackendKit-labs/bk-platform/blob/master/docs/hermes/SPEC-0008-hermes-plan-de-implementacion.md) | Hermes: plan de implementación (H0 → H1c) | P1–P6 publicados (hermes 0.2) |
| [SPEC-0009](SPEC-0009-confianza-del-workspace-y-limites-aplicados.md) | Confianza del workspace y límites aplicados | En curso (C1 y C3 implementados; C3b pendiente) |
| [SPEC-0010](SPEC-0010-cotas-por-defecto-y-orquestacion.md) | Cotas por defecto, orquestación y tipos de agente | Implementado (O1–O5 publicados; core 0.37.0, v0.38.0) |
| [SPEC-0011](SPEC-0011-mcp-server-tools-directas.md) | Tools directas (sin LLM) servidas por MCP | D1–D4 publicados (core 0.37.2, mcp-server 0.18.6, v0.38.2); D5 (migrar Steward) aplazado hasta SPEC-0014 |
| [SPEC-0012](SPEC-0012-extraccion-de-documentos.md) | Extracción de documentos a texto (`document-extract`) | Capa 1 y OCR implementados (sin publicar); capa 2 pendiente |
| [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md) | El framework como librería: hoja de ruta y trazabilidad | Borrador |
| [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) | Puntos de extensión del engine: hooks, política, aprobación y auditoría | Implementado (F0–F5, #171–#174; v0.39.0, core 0.38.0) |
| [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md) | Extraer el vertical de coding de los contratos de core | Borrador |
| [SPEC-0016](SPEC-0016-desamarrar-modulos-mixtos.md) | Desamarrar los módulos mixtos (contexto, skills, comandos, app de terminal) | Borrador |
| [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) | Un contrato por concepto: workflow, política, auditoría, memoria, RAG | Borrador |
| [SPEC-0018](SPEC-0018-plantilla-de-agente-de-negocio-y-scaffolder.md) | Plantilla de agente de negocio y scaffolder | Borrador |
| [SPEC-0019](SPEC-0019-aprendizaje-segunda-iteracion.md) | Aprendizaje, segunda iteración | F1 y F2 implementadas (sin publicar); F3 pasa a SPEC-0022 |
| [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) | Ejecución reanudable (absorbido por SPEC-0023) | Absorbido |
| [SPEC-0021](SPEC-0021-evaluaciones-de-agentes.md) | Evaluaciones de agentes sobre `RunResult` (casos, graders, repeticiones, comparación) | Borrador |
| [SPEC-0022](SPEC-0022-ciclo-de-vida-de-la-leccion.md) | Ciclo de vida de la lección (sustituye a SPEC-0019 F3) | Implementado F1-F5 (sin publicar) |
| [SPEC-0023](SPEC-0023-flujos-declarativos.md) | Motor de flujos: definición, journal, control y vista para Hermes y futuros orquestadores (diseño de SPEC-0017 F1; absorbe 0020) | Borrador |

Orden propuesto para 0020-0023 (2026-11-16, tras contrastarlos con el código): **0022** (cambia lo que hacen F1/F2 de SPEC-0019), **0023** (es lo que Steward vende: departamentos como flujos declarativos), **0021**, y **0020** queda absorbido por 0023 (el journal, el `claim` y la reanudación ya existen en el orquestador y en Hermes).

Orden de ejecución vigente: SPEC-0013 §4 (prerrequisitos) → 0014 → 0015 y 0016 (mismo minor) → 0017 por fases → 0018. Ver [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md) para la tabla de trazabilidad. Los borradores anteriores (0002, 0004 a 0007) se reevalúan contra ADR-0008 antes de retomarlos. SPEC-0004 es dependencia de la opción B de aprobación durable (SPEC-0014 §6).

Estados: Borrador, En revisión, Aprobado, Implementado.
