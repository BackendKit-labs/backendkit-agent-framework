# SPEC-0018: plantilla de agente de negocio y scaffolder

**Fecha:** 2026-11-14
**Estado:** Borrador. Sin confirmar si el template `enterprise` de `create-bk-agent` ya cubre lo que pide. *(Revisado el 2026-11-18; antes decía: Borrador)*
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) a [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) F1 (workflow).
**Tipo de cambio:** aditivo (core y create-bk-agent).
**Objetivo:** demostrar que la librería resultante sirve para construir un agente de negocio gobernado sin escribir infraestructura propia. Es la prueba de aceptación de los pasos 1 a 4 de SPEC-0013.

## 1. Por qué existe

Steward escribió `createBusinessAgent` (`steward/packages/governed-agent/src/business-agent.ts`) porque `createBaseEngine` arrastraba funciones de coding y no tenía dónde enganchar la política. Si después de los pasos 1 a 4 esta plantilla sigue necesitando código que no esté en el SDK, falta algo en los contratos.

## 2. `createBusinessAgent` en core (forma propuesta)

```ts
createBusinessAgent({
  providers, defaultProvider,
  agents: AgentProfile[],
  tools: ToolDefinition[],                 // defineTool con hechos declarados
  identity: Omit<Principal, 'agentId' | 'sessionId' | 'chain'>,
  policy?: ToolPolicy | ToolPolicy[],      // por defecto defaultToolPolicy (SPEC-0014 §4)
  approver?: Approver, approvals?: ApprovalStore,
  audit?: AuditSink | AuditSink[],         // por defecto ninguno: hay que declararlo explícitamente
  memory?: …, instructions?: InstructionSource[], skills?: SkillSource[],
  budget?: …, guardrails?: Guardrail[],
  serve?: { mcp?: ToolServerHttpOptions }  // expone las tools directas con createToolServer
})
```

Sin funciones de coding, sin disco por defecto y sin `~/.appName`.

## 3. Scaffolder

`create-bk-agent` gana una plantilla `business` que genera:
- tools de ejemplo con `defineTool` (una de lectura y una `destructive`);
- `createBusinessAgent` con `policy`, `audit` (NDJSON) y `approver` de consola;
- `runToolServer` para exponer las tools directas;
- tests con `testkit`.

## 4. Fases

- **F1.** `createBusinessAgent` en core. Test de extremo a extremo con `testkit`: una lectura se permite, una escritura destructiva pide aprobación, la auditoría registra las dos y el servidor MCP sirve las mismas tools.
- **F2.** Plantilla `business` en `create-bk-agent`, con su test de scaffold.
- **F3.** Comparación en papel con `steward/packages/governed-agent`: cada función de `createBusinessAgent` de Steward tiene su equivalente o está anotada como producto (PDP remoto, registro de agentes, cuotas).

## 5. Criterio de aceptación

Un agente de negocio gobernado se construye solo con paquetes del SDK, y el código del usuario se limita a sus tools, sus perfiles y su política.

## 6. Fuera de alcance

Migrar Steward (aplazado; se hace después de esta plantilla, una sola vez).
