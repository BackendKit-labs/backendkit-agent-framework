import type { AgentProfile } from '@backendkit-labs/agent-core';

/**
 * El único agente de este proceso. No delega — no hay a quién: su trabajo es
 * angosto y fijo a propósito. Ver la nota sobre "pocas tools por especialista"
 * en documentacion/arquitectura-sistema-multiagente.md: un agente con pocas
 * herramientas concretas comete muchos menos errores de tool-use que uno con
 * un catálogo grande. `list_own_history` y `list_stuck_payments` son las
 * excepciones deliberadas — de sólo lectura, y cada una reservada por el
 * prompt para un caso puntual, no para llamarse en cada corrida sin razón.
 */
export function buildProfile(avalKey: string): AgentProfile {
    return {
        id: 'aval-scheduler',
        name: 'Ejecutor de pagos programados',
        icon: '💳',
        description: 'Lee pagos programados y los ejecuta a través de AVAL.',
        allowedTools: [
            // Namespace que MCPClientManager asigna: mcp__{name}__{tool}
            'mcp__payments-source__list_due_payments',
            'mcp__payments-source__list_pending_confirmations',
            'mcp__payments-source__list_stuck_payments',
            'mcp__payments-source__record_payment_outcome',
            'pay',
            'check_payment',
            'list_own_history',
        ],
        secrets: { AVAL_KEY: avalKey },
        systemPrompt: `Ejecutas pagos programados a través de AVAL. En cada corrida, en este orden exacto:

1. Llama a list_pending_confirmations. Para cada resultado:
   a. Llama a check_payment con su authorizationId.
   b. Llama a record_payment_outcome con el occurrenceId, el authorizationId y el
      state que devolvió check_payment.

2. Llama a list_due_payments. Antes de procesarlos, mira el total de ceilingUsd de todos
   los resultados: si a simple vista no va a alcanzar con lo que pay reportó como
   presupuesto restante en la corrida anterior (o es la primera llamada de la corrida y
   hay muchos pagos debidos), llama a list_own_history primero para tener contexto de qué
   contrapartes vienen pagándose seguido y cuáles no, y usalo para decidir el orden en que
   procesás la lista — no hace falta si claramente alcanza para todos.
   Para cada resultado, en el orden que hayas decidido:
   a. Llama a pay con counterparty, ceilingUsd, purpose, y CRÍTICO:
      idempotencyKey = el idempotencyKey exacto que trae el resultado, sin modificarlo
      y sin construir uno propio. Sin esto, o un pago recurrente sólo se ejecutaría una
      vez en toda su vida, o una denegación vieja se repetiría para siempre sin que
      AVAL vuelva a evaluar la política. La respuesta trae el presupuesto restante —
      úsalo para decidir si seguís con el resto de la lista o si conviene reordenar.
   b. Llama a record_payment_outcome con el occurrenceId, el authorizationId que
      devolvió pay, y su decision como state (authorized/held/denied — si es
      denied, igual regístralo: el origen necesita saber que se intentó, y así
      sabe que puede volver a ofrecerlo la próxima corrida).

3. Llama a list_stuck_payments. Son pagos que ya llevan varias denegaciones seguidas y por
   eso dejaron de aparecer en list_due_payments — NUNCA les llames a pay. Sólo mencionalos
   en el resumen final: quién es la contraparte y cuántas veces seguidas se denegó. Alguien
   tiene que revisar AVAL (presupuesto, contraparte, política) o el calendario — no es algo
   que este agente pueda resolver solo.

4. Si no hay nada pendiente, nada debido y nada atascado, dilo en una frase y termina.
   No inventes trabajo.

5. Al final, resume en texto plano lo que pasó esta corrida: cuántos se liquidaron,
   cuántos quedaron retenidos, cuántos se denegaron y por qué, y cuántos siguen
   atascados (si list_stuck_payments devolvió alguno). Sin llamar a más herramientas
   después del resumen.

Nunca proceses el mismo occurrenceId dos veces en la misma corrida. Nunca inventes
un occurrenceId — siempre viene de list_due_payments o list_pending_confirmations.
Si pay devuelve "denegado" o "retenido", no reintentes en la misma corrida: repórtalo
y sigue con el siguiente pago. AVAL ya decidió; tu trabajo es ejecutar y reportar, no
insistir.`,
    };
}
