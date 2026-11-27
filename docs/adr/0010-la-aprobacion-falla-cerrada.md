# ADR-0010: la aprobación falla cerrada

**Fecha:** 2026-11-26
**Estado:** Aceptado
**Spec:** [SPEC-0023](../specs/SPEC-0023-flujos-declarativos.md) §11 (flujos), [SPEC-0041](../specs/SPEC-0041-autoridad-del-aprobador.md) §7 (autoridad del aprobador)

## Contexto

La auditoría externa del 2026-11-26 encontró, y se reprodujo contra `dist/`, que varios caminos de aprobación aprueban cuando falta algo:

| Hallazgo | Camino | Qué pasaba |
|---|---|---|
| B-01 | `runFlow`, `gate.approval: human` | Sin `approve`, el paso se aprobaba (`?? true`; el JSDoc lo documentaba: "Default: approve"). |
| C-02 | `FlowRunner` de enterprise | Igual, sin `onApprovalRequired`. |
| B-02 | `approverFromCallback` | Toda respuesta distinta de `'reject'`, incluido `undefined`, aprobaba. |
| B-03 | `runFlow`, `gate` con criterios | Sin `opts.gate`, el gate se omitía sin aviso. |
| B-04 | aprobación de paso + política | Un gate solo humano pasaba a aceptar `['human', 'agent']`. |
| B-14 | `ApprovalGate.alwaysAsk` | Si lanzaba, se trataba como "no preguntar". |
| C-01 | `ComplianceGate` | Un `reject()` se deshacía al evaluar después un criterio. |

El motor ya seguía la regla contraria ("never run because nobody can be asked", `ApprovalGate`; el sandbox sin aprobador cierra, SPEC-0006 §3.3). Los demás caminos no.

## Decisión

**Una aprobación que no se pudo obtener es un rechazo.** En todos los caminos (motor, flujos, enterprise, servidor de tools, protocolo):

1. **Sin aprobador configurado, se rechaza**, nunca se aprueba por defecto. Es un error de configuración y se dice como tal.
2. **Solo una respuesta explícita aprueba** (`'approve'`, `'approve_all'`, `true`). `undefined`, un valor desconocido o una excepción rechazan.
3. **Un control declarado que no se puede evaluar rechaza:** un `gate` sin evaluador, un `alwaysAsk` o un evaluador que lanza.
4. **Un rechazo es definitivo** dentro de su solicitud: nada posterior lo convierte en aprobación.
5. **Un requisito solo se estrecha:** si un paso pide una persona, ninguna política lo amplía a un agente. Varias fuentes se combinan por intersección; si no queda nadie, se deniega.

## Consecuencias

### Positivas
- Un olvido de configuración se ve (falla), en vez de aprobar en silencio una operación sensible.
- La misma regla en todos los caminos, como ya hizo `checkApproval` con los roles y los cuatro ojos (SPEC-0041 §7).

### Negativas / trade-offs
- Cambio de comportamiento: un flujo con `gate.approval: human` y sin aprobador, que hoy corre, falla. Quien lo usaba así (tests, demos) tiene que pasar un aprobador.

## Alternativas consideradas
- **Aprobar por defecto para que funcione sin configurar nada.** Rechazada: es lo que había, y convierte el olvido de configurar en una operación aprobada que nadie aprobó.
- **Avisar y aprobar.** Rechazada: un aviso en un log no detiene un pago.
