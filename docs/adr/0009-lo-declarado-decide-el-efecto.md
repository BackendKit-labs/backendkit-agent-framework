# ADR-0009: lo que una tool declara decide su efecto; lo no declarado tiene efecto

**Fecha:** 2026-11-26
**Estado:** Aceptado
**Spec:** [SPEC-0006](../specs/SPEC-0006-agent-sandbox.md) §7 (sandbox), [SPEC-0011](../specs/SPEC-0011-mcp-server-tools-directas.md) §2.2 (servidor de tools)

## Contexto

Cada control del framework necesita saber si una tool cambia algo: el aprobador (¿se pregunta?, ¿lo cubre "aprobar todo"?), el sandbox en `read-only` (¿se deja correr?), el servidor de tools (¿hace falta `authorize`?) y el cliente MCP (¿se cree al servidor?). Hasta v0.50.19 cada uno lo decidía distinto:

- El sandbox en `read-only` juzgaba por **nombre**: rechazaba solo lo listado en `writeTools`, vacío por defecto. Una tool `destructive` (pagar), una MCP o una propia sin declarar corría igual.
- El cliente MCP copiaba las anotaciones del servidor con `trustAnnotations`, y un servidor podía rebajar una tool de pago a `readOnlyHint: true`.
- El servidor de tools exige `authorize` solo a `destructive`: una tool que escribe y no lo declara queda expuesta.

## Decisión

**El efecto de una tool lo deciden los hechos que declara (`readOnly`, `destructive`), y lo que no se declara cuenta como efecto.** Tres niveles, los mismos en todos los controles:

| Nivel | Declaración | Aprobación | "Aprobar todo" | Sandbox `read-only` |
|---|---|---|---|---|
| Lectura | `readOnly: true` | nunca pregunta | n/a | corre |
| Efecto | `readOnly: false` o nada | pregunta | lo cubre | se rechaza |
| Irreversible | `destructive: true` | solo una persona | **nunca** lo cubre | se rechaza |

1. **Lo no declarado tiene efecto.** Olvidar un hecho pregunta de más, nunca de menos.
2. **`destructive` se reserva a lo irreversible desde fuera** (pagar, enviar, borrar). Escribir un archivo del workspace es efecto, no irreversible.
3. **Las excepciones son explícitas:** `ownStateTools` en el sandbox (tools que solo escriben el estado propio del agente) y `writeTools` como refuerzo (rechaza aunque declare `readOnly`).
4. **Lo que dice otro es una afirmación.** Las anotaciones de un servidor MCP no se creen salvo `trustAnnotations`; los hechos locales (`toolFacts`) ganan siempre; `pinnedTools` deja fuera una tool cuya definición cambió.
5. **Todo camino que sirve una tool aplica los niveles.** El servidor de tools exige `authorize` o `policy` para todo lo que no sea `readOnly: true` (auditoría 2026-11-26, B-07).

## Consecuencias

### Positivas
- Una sola regla para aprobación, sandbox, servidor y cliente MCP: se revisa un sitio, no cuatro.
- Una tool nueva, o de un tercero, empieza preguntando.

### Negativas / trade-offs
- Cambio de comportamiento: tools que corrían en `read-only` o sin `authorize` ahora se rechazan o exigen configuración. Hay que declarar los hechos.
- El framework no verifica que una tool haga lo que declara. Para una tool local quien declara es quien escribe el código que corre en el proceso: es confianza de dependencia y se resuelve revisando código.

## Alternativas consideradas
- **Juzgar por nombre (`writeTools`).** Rechazada: deja pasar todo lo que no se listó, que es lo nuevo y lo de terceros.
- **Marcar toda escritura como `destructive`.** Rechazada por el usuario: un agente de código pediría permiso a una persona por cada archivo, y "aprobar todo" dejaría de servir.
- **Creer las anotaciones del servidor MCP por defecto.** Rechazada: un servidor podría rebajar sus propias tools.
