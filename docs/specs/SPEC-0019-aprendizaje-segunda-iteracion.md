# SPEC-0019: aprendizaje, segunda iteración

**Fecha:** 2026-11-15
**Estado:** Borrador. Cada punto de §2 espera decisión del usuario.
**Depende de:** [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) F6 (módulo `learning`, mergeado) y [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (`AuditSink`, `ToolPolicy`, `ApprovalStore`).
**Tipo de cambio:** por fases, aditivas salvo F4 (esquema de regla único) y F7 (retirada de `reflection`).
**Objetivo:** que el aprendizaje sea una capacidad estándar del framework: que aprenda de una señal fiable, que la lección diga qué hacer, y que una regla tenga el mismo ciclo de vida en cualquier agente.

## 1. De dónde se parte

Hecho en SPEC-0017 F6 y en el primer bloque de mejoras (2026-11-15):

- `createLearning()` con experiencias, lecciones en el prompt y reglas propuestas que esperan a una persona.
- Una sola opción para conectarlo: `createBaseEngine({ learning })`.
- Aislamiento por tenant: experiencias, patrones, lecciones, propuestas y reglas no cruzan tenants.
- Texto de lección estable: un fallo nuevo del mismo patrón no cambia el system prompt.
- `agent-coding` y `agent-enterprise` construyen sobre el módulo.

Lo que sigue flojo, verificado en el código:

| # | Problema | Dónde |
|---|---|---|
| P1 | Solo se guardan fallos. 3 fallos en 3 llamadas pesan igual que 3 en 1000 | `experienceFromAudit` descarta los éxitos |
| P2 | No hay ventana de tiempo. Cuentan todos los fallos guardados (hasta `maxExperiences`) | `detectPatterns` |
| P3 | La clave es `dominio + tipo + sujeto`. Errores de causas distintas en la misma tool son un solo patrón | `patternKey` |
| P4 | La lección describe el síntoma ("`post_invoice`: `tool_error` keeps happening"), no qué hacer | `lessonsFor` |
| P5 | Nada marca un patrón como resuelto: la lección sigue aunque el problema se haya arreglado | no existe |
| P6 | La lección se inyecta en todos los turnos del agente, tenga o no que ver con la tarea | hook `systemPrompt` |
| P7 | Tres formas de regla: `ToolRule` (core), `PolicyRule` (coding), entrada de `manifest.yaml` (enterprise). El engine solo aplica la primera | `isToolRule`, `approvedPolicyRules`, `VaultRuleStore` |
| P8 | Medir si una regla sirve solo existe en enterprise (`recordRuleOutcome`, `demotionCandidates`) | `EnterpriseLearning` |
| P9 | No hay dónde aprobar: una propuesta queda pendiente hasta que la app escriba su propia pantalla | no existe |
| P10 | `reflection/` sigue vivo: `LessonsMemoGenerator` y `HistoricalLoader` de coding dependen de él | `coding/pipeline/reflection` |

## 2. Decisiones que hay que tomar

Cada una condiciona una fase. La columna "propuesta" es la recomendación; no está decidida.

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Cómo se registran los éxitos sin llenar el almacén? | (a) una experiencia por éxito; (b) contadores agregados por clave y periodo | **(b)**. Un agente sano hace miles de llamadas correctas; guardar cada una expulsa los fallos del almacén acotado |
| D2 | ¿Qué hace un patrón: conteo o tasa? | (a) conteo en ventana; (b) tasa de fallo en ventana con mínimo de muestras; (c) ambos, configurable | **(c)**, con conteo en ventana por defecto. La tasa exige D1 y no sirve para señales de un vertical que no tienen "éxito" (un hallazgo de auditoría) |
| D3 | ¿Qué entra en la huella del error? | (a) nada (como hoy); (b) código o clase de error que declare la tool; (c) mensaje normalizado (sin números, ids ni rutas) | **(b)** con (c) como respaldo. El mensaje normalizado es frágil; un código declarado es estable |
| D4 | ¿De dónde sale el "qué hacer" de una lección? | (a) plantilla por tipo de fallo; (b) la primera llamada correcta a la misma tool tras el fallo ("lo que funcionó"); (c) un LLM resume el grupo | **(a) + (b)**. (c) mete texto generado en el prompt y cuesta tokens en cada patrón; queda como opción del integrador |
| D5 | ¿Cuándo deja de mostrarse una lección? | (a) N éxitos seguidos del mismo sujeto; (b) sin fallos en la ventana; (c) una persona la marca resuelta | **(b)** automático y **(c)** disponible. (a) depende de D1 |
| D6 | ¿Se filtran las lecciones por relevancia? | (a) no (como hoy); (b) solo las de tools que el agente tiene disponibles en el turno; (c) coincidencia con la entrada | **(b)**. Es barato y determinista. (c) vuelve a cambiar el prompt en cada turno y rompe la caché |
| D7 | ¿Cuál es el esquema único de regla? | (a) `{ when: { tool?, agentId?, meta? }, effect: 'ask' \| 'deny', reason }` aplicado por `ToolPolicy`; las reglas de un vertical siguen opacas en `extension`; (b) dejarlo como está | **(a)**. Coding y enterprise guardan su `PolicyRule` en `extension` y core aplica la parte común |
| D8 | ¿Dónde se aprueba? | (a) tools estándar (`learning_list_proposals`, `learning_decide`) que el integrador registra; (b) un comando `/learning` en `agent-coding/cli`; (c) ambas | **(c)**. La tool de decidir exige `accepts: ['human']` |
| D9 | ¿Se mide el resultado de una regla en core? | (a) sí: cada vez que la regla hace preguntar, se cuenta si la persona aprobó o rechazó la llamada; (b) no | **(a)**. Una regla cuya pregunta siempre se aprueba es candidata a retirarse; ya está en `enterprise` |

## 3. Fases

Cada fase lleva su test de aceptación antes de tocar código y no cambia el comportamiento por defecto salvo donde se indica.

- **F1. Señal: éxitos, ventana y huella (D1, D2, D3).** Contadores de éxito por clave y periodo. `window` en `LearningOptions`. `ToolDefinition` puede declarar el código de un error (o la tool lo lanza en un error tipado) y entra en la clave. Test: 3 fallos entre 1000 éxitos no forman patrón con tasa; 3 fallos fuera de la ventana tampoco.
- **F2. Lecciones que enseñan (D4).** Plantilla por tipo de fallo y, cuando existe, la llamada correcta que siguió al fallo. Sigue pasando por el saneo y el tope. Test: tras fallo y éxito de la misma tool, la lección incluye lo que cambió, sin argumentos en claro (solo nombres de campos).
- **F3. Ciclo de vida de la lección (D5, D6).** Caducidad por ventana, `learning.resolve(patternKey)` y filtro por tools disponibles. Test: una lección desaparece al salir sus fallos de la ventana y no aparece para un agente que no tiene esa tool.
- **F4. Esquema de regla único (D7). Con ruptura** en `ApprovedRule.rule`. `learning.policy` aplica `when` + `effect`; coding y enterprise migran a `extension`. `VaultRuleStore` sigue leyendo el `manifest.yaml` actual. Test: una misma regla aprobada se aplica igual en un engine de negocio, en coding y en enterprise.
- **F5. Resultado de las reglas en core (D9).** `learning.ruleOutcomes()` y `demotionCandidates()` suben de enterprise a core. Test: una regla cuya pregunta se aprueba N veces seguidas aparece como candidata.
- **F6. Superficie de aprobación (D8).** Tools estándar y comando `/learning`. Test: un agente no puede aprobar su propia regla.
- **F7. Retirada de `reflection` (con ruptura).** `LessonsMemoGenerator` y `HistoricalLoader` de coding pasan al módulo nuevo; salen `reflection/`, `ProceduralMemory` y `EnterpriseReflection`. Con esto se vacían las excepciones `reflection/` y `project-key.ts` de los tests de grep de SPEC-0015 y SPEC-0016.

## 4. Criterios de aceptación

- Un agente con una tool que falla el 0,3 % de las veces no recibe lección ni propuesta; uno con una tool que falla 3 de 5 sí.
- La lección de una tool que se arregló desaparece sola.
- El system prompt de un agente no cambia entre dos turnos si no apareció ni caducó un patrón.
- Una regla aprobada tiene la misma forma y el mismo efecto en los tres paquetes.
- `core/src` no contiene `reflection/`.

## 5. Fuera de alcance

- Aprendizaje entre tenants (lecciones "globales" que un operador promueve a todos). Hoy está prohibido por diseño; si se quiere, es una decisión de producto aparte.
- Búsqueda semántica de experiencias (embeddings). Depende de SPEC-0017 F5 (RAG).
- Ajuste automático de umbrales.
