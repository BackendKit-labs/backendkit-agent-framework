# SPEC-0023: flujos declarativos

**Fecha:** 2026-11-16
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar. Es el diseño detallado de F1 de [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md).
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (`ToolPolicy`, `ApprovalStore`), [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) para la reanudación (F4 de este spec).
**Tipo de cambio:** por fases. Aditivo hasta F5; la retirada de los runners viejos va en el minor siguiente.
**Objetivo:** el motor de flujos completo en core (hoy partido entre core y `enterprise`), con la definición como datos y la aprobación en el `ApprovalStore`, para que sirva a agentes de negocio, a `enterprise` y a `orchestrator-agent`.

## 1. De dónde se parte (SPEC-0017 F1, verificado en el código el 2026-11-16)

| Pieza | Qué tiene | Qué le falta |
|---|---|---|
| `core/workflow` (`WorkflowRunner`, `WorkflowBuilder`) | pasos con `dependsOn`, oleadas paralelas con `maxConcurrency`, `requireApproval` con un callback en proceso | definición como datos, compensación, gates con criterios, interpolación del payload, estado reanudable |
| `enterprise/flow` (`FlowRunner`, `FlowLoader`, `ComplianceGate`; 858 líneas) | definición YAML validada con zod (ciclos, triggers, selectores de compensación), gates con criterios y evaluador, compensación `<paso>.failed`, registro de transiciones, interpolación `{{payload.x}}` | no ejecuta nada propio de concurrencia ni de espera: delega todo en `WorkflowRunner` |
| `orchestrator-agent` | plan generado por un LLM, subtareas con plazos | es una app: consumirá el contrato |

**Corrección respecto a SPEC-0017:** no hay dos runners en paralelo. `FlowRunner` **construye un `WorkflowBuilder` y ejecuta un `WorkflowRunner`** (`FlowRunner.run`), que ejecuta agentes a través de un callback `runAgent` del integrador. Lo que hay son dos capas: el esquema, la interpolación, los gates, la compensación y las transiciones viven en `enterprise`; el orden, las oleadas y la aprobación, en core. El problema real es que **la capa de datos está en el paquete equivocado** y que la aprobación de un paso es un callback en proceso (`onApprovalRequired`), no un `ApprovalStore`.

Detalles del comportamiento actual que este spec cambia o conserva:

- Compensación: se recorre `def.compensation` **en el orden declarado**, después de que termina todo el flujo, y solo para pasos `failed`. No es "orden inverso de los pasos completados".
- Interpolación: solo `{{payload}}` y `{{payload.a.b}}`; un camino ausente da `null`. Las salidas de las dependencias no se interpolan: llegan como `context` del paso.
- Un paso con aprobación se ejecuta **después** de los paralelos de su oleada y de uno en uno.
- Un ciclo o una dependencia desconocida ya se rechazan en `FlowLoader` y, si llega una `WorkflowDef` cruda, `WorkflowRunner` marca los pasos como `failed` ("Unsatisfiable dependencies").
- Un gate con criterios que no se puede evaluar **rechaza el paso** (`ComplianceGateError`) salvo `allowUnevaluatedGates`.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Cuál es el contrato? | (a) `FlowDefinition` como datos (el esquema de `enterprise`, movido a core); (b) el `WorkflowBuilder` como contrato | **(a).** Los datos se validan, se guardan, se versionan y los puede generar un LLM. `WorkflowBuilder` y el runner pasan a trabajar sobre `FlowDefinition` |
| D2 | ¿Cómo se aprueba un paso? | (a) callback `onApprovalRequired` (hoy); (b) `ApprovalStore` de SPEC-0014 con el sujeto que ya existe, `{ kind: 'workflow_step', workflow, step, input }` | **(b).** Funciona con aprobadores asíncronos y deja rastro. El callback queda como adaptador para pruebas |
| D3 | ¿Cómo se decide si un paso puede ejecutarse (política)? | (a) un contrato nuevo de política de pasos; (b) `ToolPolicy` sobre una tool sintética `flow.step:<id>` | **(b).** Es la salida que SPEC-0017 F2 ya propuso y evita un segundo motor de reglas. Las reglas aprobadas por el aprendizaje valen igual para un paso |
| D4 | ¿Qué es un gate? | (a) criterios evaluados por un LLM dentro del runner; (b) un `Gate` enchufable `(step, output) => GateResult` | **(b).** Core define la interfaz; `ComplianceGate` de `enterprise` es la implementación con criterios, evidencia y evaluador distinto del ejecutor |
| D5 | ¿Cómo se compensa un fallo? | (a) como hoy: en el orden declarado, tras el flujo, solo pasos `failed`; (b) además deshacer pasos ya completados en orden inverso | **(a) en F2, para no cambiar comportamiento.** (b) es otro problema (deshacer lo hecho, no reaccionar al fallo): se decide aparte cuando un caso lo pida, porque exige que cada paso declare cómo se deshace |
| D6 | ¿Qué reciben los pasos? | (a) como hoy: `{{payload...}}` en el prompt y las salidas de las dependencias como `context`; (b) además `{{steps.<id>.output}}` en el prompt | **(a) en F2; (b) opcional después.** La interpolación solo lee del payload y de las salidas, sin evaluar expresiones |

## 3. Diseño

```ts
interface FlowDefinition {
  name: string; version: string;
  trigger?: FlowTrigger;                  // manual | queue | webhook | cron (el disparo lo hace la app)
  steps: FlowStep[];
  compensate?: FlowCompensation[];
}
interface FlowStep {
  id: string; agent: string; prompt: string;      // {{payload.x}} y {{steps.id.output}}
  after?: string[];
  gate?: { criteria?: string[]; evaluator?: string; evidence?: 'required' | 'optional'; approval?: 'human' | 'none' };
  timeoutMs?: number;
}

runFlow(def, { payload, agents, policy?, approvals?, journal?, gates?, maxConcurrency?, signal? }): Promise<FlowResult>
```

- El orden de ejecución se calcula por `after` (oleadas, como hoy). Un ciclo se rechaza al validar, no al ejecutar.
- El runner no posee engines: llama a un `runAgent(agentId, input, context, stepId)` que da el integrador, como hoy. Ese callback puede devolver el `RunResult` del engine (SPEC-0020 y SPEC-0021 lo aprovechan) además del texto.
- `FlowResult` guarda por paso: estado, salida, error y la evidencia del gate.
- Sin `journal`, el flujo corre en memoria, como hoy.

## 4. Fases

- **F1. `FlowDefinition` y su validación en core.** El esquema zod de `enterprise` se mueve; `enterprise` lo reexporta. Test: los YAML de ejemplo de `enterprise` validan sin cambios.
- **F2. Mover la capa de datos a core.** `runFlow` absorbe lo que hoy hace `FlowRunner` (interpolación, gates enchufables, compensación, transiciones) sobre el `WorkflowRunner` de core. Test de aceptación: los tests de `core/workflow` y los de `enterprise/flow` pasan sin cambios contra el runner de core.
- **F3. Aprobación y política por paso (D2, D3).** Test: un paso con `approval: human` queda `awaiting_approval` en el `ApprovalStore`; una regla aprobada que dice `ask` para `flow.step:pagar` detiene ese paso.
- **F4. Reanudación (con SPEC-0020 F2).** Test: la caída entre dos pasos no repite el primero.
- **F5. Gates enchufables y compensación (D4, D5).** `ComplianceGate` pasa a implementar `Gate`. Test: un paso que falla compensa en orden inverso.
- **F6. Retirada.** `WorkflowRunner` y `FlowRunner` salen marcados como obsoletos un minor y se retiran en el siguiente. Con ruptura.

## 5. Criterios de aceptación

- Un flujo escrito en YAML corre igual en un agente de negocio, en `enterprise` y en una app que lo cargue con `runFlow`.
- Todo el motor (datos, orden, aprobación, compensación) en core; `enterprise` conserva `ComplianceGate` y las políticas propias de una empresa.
- La aprobación de un paso usa `ApprovalStore`; no queda ningún callback como único mecanismo.
- Un ciclo en `after` se rechaza al cargar la definición (como ya hace `FlowLoader`).

## 6. Fuera de alcance

- Un editor visual de flujos.
- Planificar con un LLM: el plan de `orchestrator-agent` se serializa como `FlowDefinition`, pero generarlo no es de este spec.
- Bucles y condicionales dentro de un flujo: si un caso real los exige, se decide aparte (los flujos con bucles tienden a necesitar un lenguaje, y eso es otro riesgo).
- Disparar los triggers (cola, webhook, cron): lo hace la app; el framework solo los declara.
