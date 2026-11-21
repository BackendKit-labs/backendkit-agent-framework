# SPEC-0041: autoridad del aprobador (quién puede aprobar esto, no solo qué tipo de aprobador)

**Fecha:** 2026-11-20
**Estado:** Borrador. **F0 y F1 hechas (2026-11-21)**, ver §5. F2 y F3 sin hacer.
**Origen:** pregunta del autor (2026-11-20): "¿cómo contempla el framework recibir la aprobación desde el id del usuario autorizado?". La respuesta honesta es que registra quién aprobó, pero no comprueba que esa persona esté autorizada. Para un framework de agentes de empresa es un hueco central.
**Depende de:** SPEC-0014 §6.2 (reglas de aprobación), `governance/approval.ts`, `ApprovalStore`, `AgentEngine.runApproved`.
**Tipo de cambio:** aditivo (campos y opciones opcionales). Sin paquete nuevo. Un cambio de comportamiento posible, la F2, va tras una opción.
**Objetivo:** que una política pueda exigir **quién** aprueba (un rol, un tenant) y que el motor lo compruebe con datos que la aplicación controla, no con lo que dice quien llama.

## 1. De dónde se parte

Verificado en `packages/core/src` el 2026-11-20:

- Una aprobación lleva `by: { kind: 'human' | 'agent' | 'service', id }`. Si falta o es inválida cuenta como rechazo (`approvalProblem`).
- El `ask` de una política solo puede restringir el **tipo** de aprobador (`accepts`). No hay forma de decir "un usuario con el rol X".
- `PolicyDecision.ask.approver` existe, pero es **texto libre** ("role, level, department") que "lee quien enruta". El motor no lo comprueba.
- `Principal.roles` y `userId` existen, pero describen a **quien pide**, no a quien aprueba.
- La regla "nadie aprueba su propia solicitud" cubre al agente y a su cadena de delegación **solo cuando el aprobador no es humano** (`by.kind !== 'human'`). Una persona que pidió la acción (`principal.userId`) puede aprobarla ella misma.
- `runApproved` sí repite la política y vuelve a comprobar el tipo del aprobador guardado, pero parte de que `by.id` es quien dice ser. `ApprovalStore.resolve` guarda lo que le pasan.
- El framework no autentica a nadie. Es correcto que no lo haga: la autenticación es de la aplicación.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo expresa la política quién aprueba? | Un campo **comprobable** en el `ask`: `approverRoles?: string[]` (basta uno de ellos), junto al `approver` de texto libre, que se mantiene como pista de enrutado. |
| D2 | ¿De dónde salen los roles del aprobador? | De un **directorio que da la aplicación** (`approverDirectory`), no de lo que declare quien llama. Si el `by` trajera sus propios roles, quien resuelve la solicitud se los pondría. |
| D3 | ¿Qué pasa si el `ask` pide roles y no hay directorio? | **Se deniega** con un motivo claro. Fallar cerrado: nunca se aprueba por no haber podido comprobar. |
| D4 | ¿Dónde se comprueba? | En el motor, al aceptar una respuesta del aprobador y en `runApproved`, junto a `approvalProblem`. No en `ApprovalStore.resolve`: el almacén guarda, no decide. |
| D5 | ¿Y quien pidió? | Una opción `forbidSelfApproval` impide que `by.id === principal.userId` apruebe, también para humanos (cuatro ojos). Opt-in al principio, porque cambia lo que hoy se permite. |
| D6 | ¿Qué queda auditado? | El evento de auditoría guarda, además de `approval.by`, los roles con los que el directorio lo reconoció y por qué regla pasó. |

## 3. Forma propuesta

```ts
// La política dice qué rol hace falta.
{ effect: 'ask', reason: 'payment above 10k', accepts: ['human'], approverRoles: ['finance'] }

// La aplicación dice quién es quién. Aquí se consulta su propio sistema de usuarios.
createBaseEngine({
  /* ... */
  approverDirectory: {
    async describe(by) { return users.find(by.id)?.then(u => ({ roles: u.roles, tenantId: u.tenantId })); },
  },
  forbidSelfApproval: true,
});
```

Si `describe` no reconoce el `id`, o devuelve roles que no incluyen ninguno de `approverRoles`, la aprobación es inválida y la llamada no se ejecuta, con el motivo en el resultado y en la auditoría. Para `tenantId`, un aprobador de otro tenant que el de la solicitud no vale.

## 4. Lo que el framework sigue sin hacer

Autenticar. Que `by.id` sea quien dice ser lo garantiza la aplicación (sesión, token, SSO) **antes** de llamar a `resolve` o devolver la respuesta del aprobador. La documentación de gobernanza y la guía "govern a payment tool" deben decirlo de forma explícita (F3).

## 5. Fases

| Fase | Qué | Criterio de hecho |
|---|---|---|
| **F0** | **Hecha.** Pruebas que fijan los huecos de hoy: una persona aprueba lo que ella misma pidió; un `ask` con `approver: 'finance'` se aprueba por cualquier humano. | `AgentEngine.approver-authority.test.ts`: 7 pruebas sobre el código actual, tres marcadas GAP que cambian a propósito en F1 y F2. |
| **F1** | **Hecha.** `approverRoles` en el `ask` y `approverDirectory` en el motor (D1 a D4, D6), con fallo cerrado. | Un aprobador sin el rol no ejecuta la llamada, ni por el aprobador inmediato ni por `runApproved`. Sin directorio, se deniega. | Hecho en `AgentEngine.approver-roles.test.ts` (19 pruebas); los roles de varias políticas se combinan por intersección y, si no queda ninguno, se deniega. |
| **F2** | `forbidSelfApproval` (D5). | Con la opción, `principal.userId` no aprueba su propia solicitud. Sin ella, nada cambia. |
| **F3** | Documentación: la autenticación es de la aplicación; ejemplo con roles. Actualizar la guía del pago. | La web y la guía lo dicen y el ejemplo corre. |

## 6. Decisiones abiertas

1. ¿`approverRoles` basta con uno (alguno de) o se necesita también "todos"? Propuesta: alguno, y una política puede combinar dos `ask` para pedir dos aprobaciones.
2. ¿Dos aprobadores para montos muy altos (dos personas distintas)? Es una extensión natural, pero se estudia aparte.
3. ¿`forbidSelfApproval` pasa a ser el valor por defecto en una versión mayor? Se decide con la experiencia de la F2.
4. ¿El directorio se cachea? Propuesta: no lo hace el framework. La aplicación decide.
