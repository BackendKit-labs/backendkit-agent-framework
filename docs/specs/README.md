# Specs

Especificaciones de cambios que afectan a varios paquetes. Cada spec enlaza los ADR que justifican sus decisiones; el ADR explica el porqué, el spec explica el qué y el cómo.

| Spec | Título | Estado |
|---|---|---|
| [SPEC-0001](SPEC-0001-agent-core-ola-1.md) | Ola 1 de capacidades de agent-core | Implementado y publicado (Ola 1 cerrada en core 0.27.0) |
| [SPEC-0002](SPEC-0002-agent-core-ola-3a.md) | Ola 3a: señal y plazo por tool, reintento tras desbordamiento, credenciales por referencia, jobs | Implementado y publicado (Ola 3a, core 0.29.0) |
| [SPEC-0003](https://github.com/BackendKit-labs/bk-platform/blob/master/docs/hermes/SPEC-0003-hermes-plano-de-control.md) | Hermes: plano de control de agentes | Borrador |
| [SPEC-0004](SPEC-0004-agent-session.md) | agent-session: log de sesión orientado a eventos | Borrador (sin implementar; sin revisar desde 2026-10-22) |
| [SPEC-0005](SPEC-0005-agent-subagents-y-agent-acp.md) | agent-subagents y agent-acp | Borrador (sin implementar; sin revisar desde 2026-10-22) |
| [SPEC-0006](SPEC-0006-agent-sandbox.md) | agent-sandbox: confinamiento y permisos | Parcial: S1 (v0.30.0) y S3a (v0.31.0) publicadas; el resto sin revisar |
| [SPEC-0007](SPEC-0007-agent-testkit-y-agent-autonomy.md) | agent-testkit y agent-autonomy | Parcial: la parte A (`agent-testkit`) publicada; falta el servidor mock de Anthropic y el reloj falso; la parte B (autonomía) sin revisar contra `triggers` y `jobs` de core |
| [SPEC-0008](https://github.com/BackendKit-labs/bk-platform/blob/master/docs/hermes/SPEC-0008-hermes-plan-de-implementacion.md) | Hermes: plan de implementación (H0 → H1c) | P1–P6 publicados (hermes 0.2) |
| [SPEC-0009](SPEC-0009-confianza-del-workspace-y-limites-aplicados.md) | Confianza del workspace y límites aplicados | En curso: C1, C3 y C3b publicadas (v0.34 a v0.36); C2 sin confirmar, C4 con decisión pendiente, C5 solo diseño |
| [SPEC-0010](SPEC-0010-cotas-por-defecto-y-orquestacion.md) | Cotas por defecto, orquestación y tipos de agente | Implementado (O1–O5 publicados; core 0.37.0, v0.38.0) |
| [SPEC-0011](SPEC-0011-mcp-server-tools-directas.md) | Tools directas (sin LLM) servidas por MCP | D1 a D4 publicados (core 0.37.2, mcp-server 0.18.6, v0.38.2); D5 (migrar Steward) aplazado |
| [SPEC-0012](SPEC-0012-extraccion-de-documentos.md) | Extracción de documentos a texto (`document-extract`) | Capa 1 y OCR publicados (v0.38.1); capa 2 pendiente |
| [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md) | El framework como librería: hoja de ruta y trazabilidad | Hoja de ruta: SPEC-0014, 0015 y 0016 hechas; 0017 parcial; 0018 sin confirmar |
| [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) | Puntos de extensión del engine: hooks, política, aprobación y auditoría | Implementado (F0–F5, #171–#174; v0.39.0, core 0.38.0) |
| [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md) | Extraer el vertical de coding de los contratos de core | Implementado y publicado (#179, #180; core 0.39.0, agent-coding 0.29.0) |
| [SPEC-0016](SPEC-0016-desamarrar-modulos-mixtos.md) | Desamarrar los módulos mixtos (contexto, skills, comandos, app de terminal) | Implementado y publicado (#182, #183; core 0.40.0, agent-coding 0.30.0) |
| [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) | Un contrato por concepto: workflow, política, auditoría, memoria, RAG | Parcial: F6 (autoaprendizaje) publicada (v0.42.0); F1 la implementa SPEC-0023; F5 se amplía en SPEC-0033 (borrador); F2 a F4 sin confirmar |
| [SPEC-0018](SPEC-0018-plantilla-de-agente-de-negocio-y-scaffolder.md) | Plantilla de agente de negocio y scaffolder | Borrador (sin confirmar si el template `enterprise` ya lo cubre) |
| [SPEC-0019](SPEC-0019-aprendizaje-segunda-iteracion.md) | Aprendizaje, segunda iteración | F1 y F2 publicadas (v0.43.0); F3 pasó a SPEC-0022; F4 a F7 sin hacer |
| [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) | Ejecución reanudable (absorbido por SPEC-0023) | Absorbido |
| [SPEC-0021](SPEC-0021-evaluaciones-de-agentes.md) | Evaluaciones de agentes sobre `RunResult` (casos, graders, repeticiones, comparación) | En curso: F0 a F5 hechas (F0 a F4 publicadas en core 0.47.1 y testkit 0.1.18); quedan F2b y F6 |
| [SPEC-0022](SPEC-0022-ciclo-de-vida-de-la-leccion.md) | Ciclo de vida de la lección (sustituye a SPEC-0019 F3) | Implementado y publicado (F1 a F4 en v0.44.0; F5 medida en el banco `trading-bot`) |
| [SPEC-0023](SPEC-0023-flujos-declarativos.md) | Motor de flujos: definición, journal, control y vista para Hermes y futuros orquestadores (diseño de SPEC-0017 F1; absorbe 0020) | Implementado en su mayor parte y publicado (F1 a F6c, v0.44.0 a v0.46.0); pendientes F6d (Hermes, en `bk-platform`) y F7 (retirar `WorkflowRunner` y `FlowRunner`) |
| [SPEC-0024](SPEC-0024-journal-de-corridas-ndjson.md) | Journal de corridas en un archivo por corrida, con cadena de integridad | Cerrada (F1, F2 y F4 hechas; F3 descartado) |
| [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md) | Mejoras tras comparar con otros frameworks (índice y orden de ejecución) | Índice vigente: la Ola A está hecha (0029, 0028, 0030) salvo 0037, en pausa |
| [SPEC-0026](SPEC-0026-control-de-flujo-en-flows.md) | Control de flujo en flows: reintentos por paso, foreach, repeat, sleep y waitFor | Borrador |
| [SPEC-0027](SPEC-0027-reiniciar-un-flow-desde-un-paso.md) | Bifurcar o reiniciar una corrida desde un paso | Borrador |
| [SPEC-0028](SPEC-0028-journals-en-sqlite-y-postgres.md) | RunJournal en SQLite y Postgres, con batería común de pruebas | Implementado y publicado (F0 a F3, `agent-flow-sql`); sin probar con Neon |
| [SPEC-0029](SPEC-0029-adaptador-de-providers-del-ai-sdk.md) | Adaptador de modelos del AI SDK de Vercel a LLMProvider | F0 a F3 hechas y publicadas; F4 y F5 sin hacer; sin probar con Anthropic, OpenAI ni Gemini |
| [SPEC-0030](SPEC-0030-busqueda-de-tools.md) | Búsqueda de tools con carga diferida | Implementado y publicado (F0 a F5 y el modo `message`) |
| [SPEC-0031](SPEC-0031-consola-de-desarrollo-local.md) | Consola de desarrollo local (chat, llamadas, aprobaciones, flows, lecciones) | Borrador |
| [SPEC-0032](SPEC-0032-memoria-de-trabajo.md) | Memoria de trabajo (evaluar antes de construir) | Borrador |
| [SPEC-0033](SPEC-0033-rag-generico.md) | RAG genérico: contratos, embeddings, reranking y almacenes (amplía SPEC-0017 F5) | Borrador |
| [SPEC-0034](SPEC-0034-agente-durable.md) | Bucle del agente reanudable (con criterio de entrada) | Borrador |
| [SPEC-0035](SPEC-0035-code-mode.md) | Code mode: el modelo escribe código que llama tools en un sandbox (decisión previa abierta) | Borrador |
| [SPEC-0036](SPEC-0036-handoff.md) | Traspaso de control entre agentes (con criterio de entrada) | Borrador |
| [SPEC-0037](SPEC-0037-codemods-y-guias-de-migracion.md) | Codemods y guías de migración | En pausa (el paquete se retirará; la guía sigue) |
| [SPEC-0038](SPEC-0038-evaluar-lo-aprendido.md) | Evaluar lo que el agente aprendió (efecto observado y contrafactual de una regla; lo decide una persona) | Borrador (con criterio de entrada) |
| [SPEC-0039](SPEC-0039-observabilidad-de-operaciones.md) | Observabilidad de operaciones: correlación, coste atribuido, paquete de incidente y replay en seco | En curso: F0 y F1 hechas y publicadas (core 0.47.2); F2 a F5 con criterio de entrada |
| [SPEC-0040](SPEC-0040-disenador-de-agentes-en-la-web.md) | Diseñador de agentes en la web: de una tarea al diseño y a los pasos para construirlo (clave del visitante, plantillas deterministas) | Borrador: F0 hecha; F1 implementada, falta la prueba con un modelo real; F2 y F3 pendientes |
| [SPEC-0041](SPEC-0041-autoridad-del-aprobador.md) | Autoridad del aprobador: que la política exija un rol y el motor lo compruebe con un directorio de la aplicación; cuatro ojos opcional | Implementada: F0 a F3 hechas (F0 y F1 publicadas en core 0.48.1; F2 en `master`, sin publicar) |
| [SPEC-0042](SPEC-0042-evidencia-verificable-por-terceros.md) | Evidencia verificable por terceros: puntos de control firmados (Ed25519), anclaje opcional, caducidad de aprobaciones e interfaz de credential broker | Implementada: F0 (auditoría) a F4 hechas (F1 y F2 publicadas en core 0.48.3 y 0.48.4; F3 y F4 en `master`, sin publicar) |
| [SPEC-0043](SPEC-0043-apoderamiento-de-agentes.md) | Apoderamiento de agentes: un poder delegado, verificable y con limites (quien, que, sobre que, hasta cuanto), con interfaz en core y paquete opcional; no depende de Steward | F1 y F2 implementadas (paquete sin publicar); F3 a la espera del formato de la credencial |

Orden propuesto para 0020-0023 (2026-11-16, tras contrastarlos con el código): **0022** (cambia lo que hacen F1/F2 de SPEC-0019), **0023** (es lo que Steward vende: departamentos como flujos declarativos), **0021**, y **0020** queda absorbido por 0023 (el journal, el `claim` y la reanudación ya existen en el orquestador y en Hermes).

Orden de ejecución vigente: SPEC-0013 §4 (prerrequisitos) → 0014 → 0015 y 0016 (mismo minor) → 0017 por fases → 0018. Ver [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md) para la tabla de trazabilidad. Los borradores anteriores (0002, 0004 a 0007) se reevalúan contra ADR-0008 antes de retomarlos. SPEC-0004 es dependencia de la opción B de aprobación durable (SPEC-0014 §6).

**Estados revisados el 2026-11-18** contra el CHANGELOG y el código (cada "publicado" cita la versión). Dos specs, SPEC-0003 y SPEC-0008, viven en `bk-platform` y no se han revisado aquí. Donde dice "sin confirmar" o "sin revisar" falta contrastar la spec con el código; no se ha dado por hecho ni por pendiente.

Las SPEC-0026 a 0037 nacen del análisis comparativo del 2026-11-17: su índice, orden por olas y modo de retomarlas está en [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). SPEC-0021 (evals) forma parte de esa lista.

Estados: Borrador, En revisión, Aprobado, Implementado.
