# SPEC-0011: tools directas (sin LLM) servidas por MCP

**Fecha:** 2026-10-28. Revisada el 2026-11-14 tras verificar el uso real en Steward.
**Estado:** D1 a D4 implementados y publicados (core 0.37.2, mcp-server 0.18.6, v0.38.2). D5 (migrar Steward) aplazado por decisión del usuario. *(Revisado el 2026-11-18; antes decía: D1–D4 implementados (rama `feat/spec-0011-tool-server`, sin publicar). D5 (migrar Steward) aplazado por decisión del usuario.)*
**Depende de:** [ADR-0007](../adr/0007-un-limite-declarado-debe-aplicarse.md), SPEC-0009 (confianza y límites)
**Origen:** propuesta de Steward (Fase 7). Verificado contra el código el 2026-10-28; disparador cumplido el 2026-11-14.
**Objetivo:** que el SDK sirva tools deterministas (`execute` directo, sin pasar por el engine) por MCP con transporte, auth y guards propios, para que ningún consumidor tenga que reimplementar el servidor.

## 1. Problema

`AgentMCPServer` (`packages/mcp-server/src/agent-server.ts`) solo conoce un tipo de tool: `buildPrompt` → `runWithEngine`. Una lectura determinista ("saldos al 31 de octubre") o una operación sin margen de creatividad ("contabilizar el borrador X") obliga a pasar por el LLM. Quien necesita tools directas duplica el servidor.

No se trata de hacer el SDK "más determinista": se trata de poder **quitar el modelo del camino** cuando no hace falta. Los dos caminos conviven: lo interpretativo va por prompt (que a su vez puede invocar tools directas) y lo determinista, directo.

### 1.1 Lo que pasó mientras la SPEC esperaba (verificado el 2026-11-14)

La SPEC decía "esperar un segundo consumidor". En `../steward` hay **siete** agentes contables (`accountant`, `close`, `ordertocash`, `procuretopay`, `reporting`, `tax`, `treasury`), cada uno con su `src/mcp/servidor.ts` + `http.ts` + `cli.ts` sobre `@modelcontextprotocol/sdk`. Todos sus prompts pedían usar `@backendkit-labs/mcp-server`; todos concluyeron que no aplica (P2P ADR-26, accountant spec-phase6 §1.1, close spec-phase7). Lo que cada uno reimplementó, y que por tanto le faltaba al SDK:

1. Metadatos de tool que `ToolDefinition` no tenía (`soloLectura`, `nivelAutonomia`, `operacionErp`, `version`), mapeados a `annotations` MCP y a `_meta`. Hermes lee `_meta.nivelAutonomia` para compararlo con el manifiesto.
2. Invariantes al construir (solo lectura ⇒ consulta; escritura ⇒ nivel ≥ 1).
3. Un `ExecutionContext` mínimo falso (`memoriaNula`, `askAgent` que lanza), copiado cinco veces.
4. HTTP **sin sesiones**: servidor y transporte por petición, bearer en tiempo constante, cuerpo ≤ 1 MB, se niega a arrancar fuera de loopback sin token.
5. CLI `bk-mcp` con `--http --port --host --token`, stdio por defecto, logs a stderr.
6. No instalaron `mcp-server` porque arrastra `better-sqlite3`, `agent-coding` y `tree-sitter` para un `isAuthorized` de seis líneas (P2P ADR-26).
7. Divergencias entre copias que prueban la falta de estándar: `isError` cuando `ok=false` en unas y nunca en otras; `inputSchema` como `.shape`, objeto Zod entero, shape crudo o JSON Schema con `Server` de bajo nivel.

## 2. Diseño (como quedó implementado)

**Decisión que cambia respecto al borrador:** el servidor de tools directas vive en **`@backendkit-labs/agent-core`** (`src/mcp/tool-server*.ts`, exportado desde la raíz y desde `agent-core/mcp`), no en `mcp-server`. Razones: `agent-core` ya depende del SDK de MCP y los consumidores ya dependen de `agent-core`; así se resuelve el punto 6 sin crear un paquete ni podar `mcp-server` (lo que rompería el bin `bk-mcp` de código).

**Segunda desviación (D4):** `AgentMCPServer` no usa `kind: 'prompt' | 'direct'` en una unión. Recibe un campo **separado** `directTools?: ToolDefinition[]` (más `authorize`, `audit`, `context`, `maxOutputChars`, `toolTimeoutMs`) y delega en `createToolRegistrar` de core. `tools: AgentToolDef[]` no cambia de tipo; `engineFactory` pasa a opcional y el constructor lanza si hay tools de prompt sin él, si un nombre está en las dos listas o si una tool directa `destructive` no tiene `authorize`.

### 2.1 Hechos declarados en `ToolDefinition` (raíz del punto 1)

```ts
interface ToolDefinition {
  // ...existentes
  title?: string;
  readOnly?: boolean;      // implica concurrencySafe; incompatible con destructive   → readOnlyHint
  destructive?: boolean;   // no puede ser concurrencySafe                            → destructiveHint
  idempotent?: boolean;    //                                                         → idempotentHint
  openWorld?: boolean;     //                                                         → openWorldHint
  meta?: Record<string, unknown>; // libre; el engine no lo lee                      → _meta
}
```

- `defineTool` acepta los mismos campos y lanza `ToolDefinitionError` al definir si se contradicen. `validateToolDefinition(tool)` para tools escritas a mano. `getToolInputSchema(tool)` devuelve el Zod original (un `WeakMap`, `ToolDefinition` sigue siendo un objeto plano).
- `MCPClientManager` copia esos hechos desde `annotations`/`_meta` **solo con `trustAnnotations: true`** (lo que un servidor dice de sus tools es una afirmación). `title` se copia siempre.
- No se infiere `readOnly` desde `concurrencySafe` (sentido inverso): las ~200 tools existentes no cambian.

### 2.2 `createToolServer(opts)` / `createToolServerFactory(opts)`

```ts
interface ToolServerOptions {
  name: string; version?: string; tools: ToolDefinition[];
  context?: Partial<ExecutionContext> | ((call) => ExecutionContext);
  authorize?: (call: { tool, args, sessionId?, requestId }) => boolean | Promise<boolean>;
  audit?: (record: ToolCallRecord) => void | Promise<void>;
  maxOutputChars?: number;   // 1 048 576
  toolTimeoutMs?: number;    // para tools sin timeoutMs propio
}
```

- **Esquema de entrada.** Las tools de `defineTool` se registran con su Zod original (cero conversión: el cliente valida contra lo mismo que `execute`). Una `ToolDefinition` a mano pasa por `z.fromJSONSchema(parameters, { defaultTarget: 'openapi-3.0' })` y **lanza** al construir si el esquema no se puede expresar. Esto reemplaza la "guardia de conversión" (D3) del borrador: solo hay conversión en el caso minoritario y falla fuerte.
- **Registro** con `McpServer.registerTool(name, { title, description, inputSchema, annotations, _meta }, cb)`; el SDK responde los argumentos inválidos con `isError` y mensaje `-32602` sin que `authorize`/`execute` lleguen a verse.
- **Validación una vez:** nombres duplicados, hechos contradictorios y esquemas se comprueban en `createToolServerFactory`; la fábrica construye un `McpServer` por conexión (stdio: uno; HTTP sin estado: uno por petición).
- **Por llamada:** `authorize` → `ExecutionContext` (`createToolContext` con `agentId` = nombre del servidor, `sessionId` = sesión MCP o `'mcp'`, `signal` que aborta por cancelación del cliente o `timeoutMs`) → `execute` → tope de salida → `audit`.
- **Contrato de errores:** `isError: true` solo si la llamada **no terminó** (`denied`, `timeout`, `error` con mensaje sin stack, `too_large`). Lo que la tool devuelve es payload, incluido un `{ ok: false }` de negocio. Transporte ≠ negocio. Esto resuelve el punto 7.
- **Seguridad (bloqueante del borrador, cumplida):** `authorize` es obligatorio si alguna tool es `destructive` (el constructor lanza); `audit` recibe cada llamada, también las denegadas y fallidas, con SHA-256 de los argumentos canónicos y nunca los argumentos; tope de salida. Si `audit` lanza, va a stderr y el resultado no cambia (la tool ya corrió; marcar `isError` haría reintentar una escritura hecha).
- `annotations` MCP siguen siendo pistas para el cliente, no un control.

### 2.3 `startToolServerHttp(opts, http)`: Streamable HTTP sin estado

Un `McpServer` y un `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` por petición. Bearer obligatorio en tiempo constante; sin token no escucha fuera de loopback; en loopback rechaza con 403 `Host`/`Origin` no loopback (misma regla que `mcp-server` y `mcp-connectors`); solo `POST <path>` (405 al resto: sin sesiones no hay stream SSE ni `DELETE`); 413 por encima de `maxBodyBytes` (1 MiB); 404 fuera de `path` (`/mcp`). La variante con sesiones y TTL sigue en `mcp-server` para engines, que sí tienen estado.

### 2.4 `runToolServer(opts, cli)`: la CLI de siempre

stdio por defecto; `--http --port <n> --host <h> --token <t>`; token también desde `tokenEnv` (`BK_MCP_TOKEN` por defecto); `--help` a stderr; opciones desconocidas rechazadas; logs a stderr (en stdio, stdout es el protocolo). `parseToolServerArgs` y `toolServerUsage` exportados sueltos.

### 2.5 Impacto en consumidores existentes

Ninguno. Campos nuevos opcionales y ausentes si no se declaran; `AgentToolDef` de `mcp-server` **no** se convierte en unión (bk-coder-v2 y aiops lo usan como `AgentToolDef<typeof schema>`); `trustAnnotations` sigue apagado por defecto; `mcp-server` conserva sus dependencias y su bin.

## 3. Verificado

| Comprobación | Resultado |
|---|---|
| `z.fromJSONSchema` | zod 4.6.7 instalado; "semi-experimental" según su JSDoc. Solo se usa para tools sin Zod propio; test de ida y vuelta (`properties`, `required`, `nullable`) en `tool-server.test.ts`. |
| SDK MCP | 1.32.1 instalado (core declara `^1.12.0`; `registerTool` con `inputSchema` como objeto Zod, `annotations` y `_meta`). |
| Argumentos inválidos | El SDK responde `isError` con `-32602`; `execute` no corre. |
| `nullable: true` (dialecto openapi-3.0 de `defineTool`) | Con `defaultTarget: 'openapi-3.0'` acepta `null`. |
| Construcciones no soportadas (`if/then/else`, `not`, `$ref` externo) | Lanzan al construir el servidor, nombrando la tool. |
| Suite de core | 76 suites / 845 tests en verde, 47 nuevos (defineTool, createToolContext, tool-server, HTTP, CLI). |

**No verificado:** el catálogo real de Steward servido con esto (siguiente paso: migrar `procuretopay-agent`).

## 4. Fases

1. **D1: tipo y registro.** Hecho (en `agent-core`, no en `mcp-server`).
2. **D2: seguridad.** Hecho: `authorize` obligatorio para `destructive`, `audit`, tope de salida, `ExecutionContext` con `signal` y `timeoutMs`.
3. **D3: guardia de conversión.** Hecho por diseño: cero conversión para `defineTool`; fallo fuerte para el resto.
4. **D4: `AgentMCPServer` con `directTools`.** Hecho: campo separado, `createToolRegistrar` registra las tools directas en el `McpServer` de cada sesión (el `audit` recibe el id de sesión MCP real). Sección nueva en el README de `mcp-server`. No se deduplicó `isLoopbackRequest` (opcional; ambas copias siguen la misma regla). Release pendiente.
5. **D5: migración de Steward (aplazada).** `procuretopay-agent` primero: `HerramientaP2P` pasa a `defineTool({ readOnly, destructive, meta: { nivelAutonomia, operacionErp, version } })`, `servidor.ts`/`http.ts`/`cli.ts` se borran, `authorize` valida la `Aprobacion` del gate. Después los otros seis.

## 5. Fuera de alcance

- Tocar el engine o el transporte de `mcp-server`.
- `engineFactory` por tool.
- Dos implementaciones (prompt y direct) bajo el mismo nombre.
- Validar JSON Schema en el servidor para tools a mano más allá de lo que expresa `fromJSONSchema`.
