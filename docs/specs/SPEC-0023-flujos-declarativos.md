# SPEC-0023: flujos declarativos

**Fecha:** 2026-11-16
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar. Es el diseño detallado de F1 de [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md).
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (`ToolPolicy`, `ApprovalStore`), [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) para la reanudación (F4 de este spec).
**Tipo de cambio:** por fases. Aditivo hasta F5; la retirada de los runners viejos va en el minor siguiente.
**Objetivo:** un solo motor de flujos en core, con la definición como datos, que sirva a agentes de negocio, a `enterprise` y a `orchestrator-agent`.

## 1. De dónde se parte (SPEC-0017 F1, verificado)

| Pieza | Qué tiene | Qué le falta |
|---|---|---|
| `core/workflow` (`WorkflowRunner`, `WorkflowBuilder`) | pasos con `dependsOn`, oleadas paralelas con `maxConcurrency`, `requireApproval` con un callback en proceso | definición como datos, compensación, gates con criterios, interpolación del payload, estado reanudable |
| `enterprise/flow` (`FlowRunner`, `FlowLoader`, `ComplianceGate`) | definición YAML validada con zod, triggers, gates con criterios y evaluador, compensación `<paso>.failed`, registro de transiciones | concurrencia acotada; su propio runner de agentes |
| `orchestrator-agent` | plan generado por un LLM, subtareas con plazos | es una app: consumirá el contrato |

Dos runners con modelos distintos para el mismo concepto. Cada mejora (aprobación, reanudación, política) hay que hacerla dos veces.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Cuál es el contrato? | (a) `FlowDefinition` como datos (el esquema de `enterprise`, movido a core); (b) el `WorkflowBuilder` como contrato | **(a).** Los datos se validan, se guardan, se versionan y los puede generar un LLM. `WorkflowBuilder` pasa a ser un constructor de `FlowDefinition` |
| D2 | ¿Cómo se aprueba un paso? | (a) callback `onApprovalRequired` (hoy); (b) `ApprovalStore` de SPEC-0014 con `subject: 'flow_step'` | **(b).** Funciona con aprobadores asíncronos y deja rastro. El callback queda como adaptador para pruebas |
| D3 | ¿Cómo se decide si un paso puede ejecutarse (política)? | (a) un contrato nuevo de política de pasos; (b) `ToolPolicy` sobre una tool sintética `flow.step:<id>` | **(b).** Es la salida que SPEC-0017 F2 ya propuso y evita un segundo motor de reglas. Las reglas aprobadas por el aprendizaje valen igual para un paso |
| D4 | ¿Qué es un gate? | (a) criterios evaluados por un LLM dentro del runner; (b) un `Gate` enchufable `(step, output) => GateResult` | **(b).** Core define la interfaz; `ComplianceGate` de `enterprise` es la implementación con criterios, evidencia y evaluador distinto del ejecutor |
| D5 | ¿Cómo se compensa un fallo? | (a) no se compensa; (b) `compensate: { on: '<paso>.failed', agent, prompt }` como en `enterprise` | **(b).** Ya está validado en `enterprise`. Se ejecuta en orden inverso a los pasos completados |
| D6 | ¿Qué reciben los pasos? | (a) solo la salida de sus dependencias; (b) además un `payload` inicial con interpolación `{{payload.campo}}` | **(b).** Es lo que usa `enterprise`. La interpolación solo lee del payload y de las salidas, sin evaluar expresiones |

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
- Cada paso se ejecuta con el engine del agente indicado y devuelve su `RunResult` (SPEC-0020 y SPEC-0021 lo aprovechan).
- `FlowResult` guarda por paso: estado, salida, error y la evidencia del gate.
- Sin `journal`, el flujo corre en memoria, como hoy.

## 4. Fases

- **F1. `FlowDefinition` y su validación en core.** El esquema zod de `enterprise` se mueve; `enterprise` lo reexporta. Test: los YAML de ejemplo de `enterprise` validan sin cambios.
- **F2. Un runner.** `runFlow` ejecuta los tests de `core/workflow` y los de `enterprise/flow`. `WorkflowBuilder` produce `FlowDefinition`. Test de aceptación: los dos conjuntos de tests existentes pasan contra el runner único.
- **F3. Aprobación y política por paso (D2, D3).** Test: un paso con `approval: human` queda `awaiting_approval` en el `ApprovalStore`; una regla aprobada que dice `ask` para `flow.step:pagar` detiene ese paso.
- **F4. Reanudación (con SPEC-0020 F2).** Test: la caída entre dos pasos no repite el primero.
- **F5. Gates enchufables y compensación (D4, D5).** `ComplianceGate` pasa a implementar `Gate`. Test: un paso que falla compensa en orden inverso.
- **F6. Retirada.** `WorkflowRunner` y `FlowRunner` salen marcados como obsoletos un minor y se retiran en el siguiente. Con ruptura.

## 5. Criterios de aceptación

- Un flujo escrito en YAML corre igual en un agente de negocio, en `enterprise` y en una app que lo cargue con `runFlow`.
- Un solo runner en core; `enterprise` conserva `ComplianceGate`, `FlowLoader` y los triggers.
- La aprobación de un paso usa `ApprovalStore`; no queda ningún callback como único mecanismo.
- Un ciclo en `after` se rechaza al cargar la definición.

## 6. Fuera de alcance

- Un editor visual de flujos.
- Planificar con un LLM: el plan de `orchestrator-agent` se serializa como `FlowDefinition`, pero generarlo no es de este spec.
- Bucles y condicionales dentro de un flujo: si un caso real los exige, se decide aparte (los flujos con bucles tienden a necesitar un lenguaje, y eso es otro riesgo).
- Disparar los triggers (cola, webhook, cron): lo hace la app; el framework solo los declara.
