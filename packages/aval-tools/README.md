# @backendkit-labs/aval-tools

Herramientas de pago para agentes de `@backendkit-labs/agent-core` que gastan a través de una
instancia de [AVAL](../../../../workspace-ideas/internet) — credencial por agente, presupuesto
previo y bitácora encadenada.

## Qué trae

- **`pay`** — la vía amarrada: el agente pide un techo de gasto, AVAL decide y paga. Devuelve
  el resultado como texto: pagado (con el coste real y la referencia del carril), retenido
  (con el `authorizationId` para consultar después) o denegado (con el motivo) — y en los tres
  casos, el presupuesto que le queda al agente (`remainingToday`/`remainingTotal`), que AVAL ya
  manda en cada respuesta. Sin verlo, un agente que pide varios gastos en el mismo turno no
  tiene forma de saber si le va a alcanzar antes de pedir el siguiente.
- **`check_payment`** — consulta el estado de una autorización propia por `authorizationId`.
  Es la pieza que le faltaba al framework para la vía "retenido": nada bloquea una sesión
  esperando a un humano, así que un gasto retenido se resuelve volviendo a preguntar más
  tarde — en otra invocación, disparada por un trigger o por el propio usuario.
- **`list_own_history`** — el historial propio del agente en AVAL (`GET /api/v1/history`), en
  texto legible. `pay`/`check_payment` sólo muestran UN gasto puntual; esto le da al agente
  contexto de patrones (qué se pagó, a quién, con qué frecuencia) para priorizar cuando el
  presupuesto no va a alcanzar para todo. De sólo lectura, y pensado para usarse cuando hace
  falta, no en cada turno.

Ninguna herramienta guarda dinero ni credenciales del proveedor: eso lo tiene AVAL.

## Instalación

```bash
npm install @backendkit-labs/aval-tools
```

## Uso

```ts
import { AgentEngine, ToolRegistry } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';

const tools = new ToolRegistry();
for (const tool of createAvalTools({ baseUrl: 'https://aval.internal' })) {
    tools.register(tool);
}

const profile = {
    id: 'expedientes-bot',
    // ...
    allowedTools: ['pay', 'check_payment', 'list_own_history' /* ... */],
    // La clave vive en el perfil de ESTE agente, no en una variable de entorno
    // compartida por todos. Cárgala desde donde guardes secretos (vault,
    // gestor de secretos del proveedor de nube, etc.), nunca en texto plano
    // en un fichero que se vaya a commitear.
    secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
};
```

## Configuración

```ts
interface AvalToolsConfig {
    baseUrl: string;       // dónde está AVAL
    secretName?: string;   // nombre de la credencial en ctx.secrets — por defecto "AVAL_KEY"
    timeoutMs?: number;    // por defecto 15000
    maxAttempts?: number;  // por defecto 3
}
```

## El flujo de un gasto retenido

```
1. El agente llama a pay("tarifas.aduana", 0.70, "Actualización trimestral").
   → "Retenido para aprobación humana. authorizationId=auth_xyz. [...]"
   El turno del agente termina ahí. No hace falta que la sesión siga viva.

2. Horas después, alguien aprueba el gasto desde la consola de AVAL —
   aprobar es pagar: AVAL usa su propia credencial, el agente no interviene.

3. Una invocación nueva del agente (un cron, un webhook, o simplemente el
   usuario preguntando "¿ya se aprobó eso?") llama a
   check_payment("auth_xyz").
   → "auth_xyz → liquidado — el pago se completó. [...]"
```

## Por qué reintentar no duplica el gasto

`pay` deriva una clave de idempotencia a partir de la sesión y los argumentos exactos de la
llamada (`sha256(sessionId:counterparty:ceiling:purpose)`). Un reintento del propio agente
tras un timeout de red produce la misma clave y AVAL lo trata como una repetición, no como un
segundo gasto. Una llamada genuinamente distinta —otro importe, otro propósito, otra sesión—
obtiene una clave distinta por sí sola.

## Qué pasa si AVAL no responde

Las tres herramientas reintentan automáticamente ante errores de red o 5xx (backoff
exponencial con `jitter`, tres intentos por defecto). Los 4xx —denegado, credencial revocada,
límite superado— nunca se reintentan: son respuestas de negocio, no fallos de transporte, y
se devuelven al agente como texto para que decida qué hacer.
