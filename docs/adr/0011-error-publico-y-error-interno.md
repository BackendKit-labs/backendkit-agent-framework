# ADR-0011: error público y error interno

**Fecha:** 2026-11-26
**Estado:** Aceptado
**Spec:** [SPEC-0011](../specs/SPEC-0011-mcp-server-tools-directas.md) §2.2 (servidor de tools); `agent-protocol` 0.8.0 (CHANGELOG v0.50.19)

## Contexto

Los servidores del framework enviaban al cliente el `message` de cualquier error: el servidor de tools (`Tool "x" failed: <mensaje>`, también para `authorize` y el aprobador), `agent-protocol` y los conectores de `mcp-connectors` (hasta 500 caracteres del cuerpo de error del servicio externo, auditoría C-11). Un mensaje interno lleva rutas, IPs, SQL, cuerpos de respuesta con datos personales o detalles útiles para un atacante. Además los tests fijaban ese comportamiento, y por eso parecía correcto.

## Decisión

**Al cliente solo llega un error que el código marca como público. Cualquier otro llega como `internal error (<errorId>)`, y el detalle va al operador.**

1. **Públicos son los errores tipados**: `ToolError(code, message)` en tools, `CapabilityError` y `ControlError` en `agent-protocol`. Su mensaje se escribe para el cliente.
2. **Cualquier otro error es interno**: el cliente recibe un `errorId` y el error completo va a `onInternalError(err, { errorId, ... })`, por defecto stderr. El mismo `errorId` en ambos lados permite correlacionar.
3. **La auditoría guarda el código, no el mensaje** (`errorCode`): la auditoría también se comparte.
4. **Un fallo de negocio se devuelve como resultado o como error tipado**, no como un `Error` cualquiera.
5. **Un test no vuelve correcto un antipatrón:** si un test fija que el mensaje interno llega al cliente, se cambia el test.

## Consecuencias

### Positivas
- Lo que ve el cliente lo decide quien escribe el error, no lo que haya en el mensaje.
- El operador conserva el detalle completo, correlacionable por `errorId`.

### Negativas / trade-offs
- Cambio de comportamiento: quien comunicaba fallos de negocio con un `Error` normal debe pasar a `ToolError` / `CapabilityError`.
- Depurar desde el cliente exige mirar el log del servidor.

## Alternativas consideradas
- **Enviar el mensaje y filtrar patrones** (rutas, IPs). Rechazada: un filtro por patrones siempre deja algo fuera.
- **Enviar el mensaje solo en desarrollo.** Rechazada: es el entorno donde más se copian configuraciones a producción.
