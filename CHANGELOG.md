# Changelog

## Sin publicar

**La herencia de políticas del sandbox compara las raíces donde de verdad caen (auditoría E-03).** `checkNarrower` comparaba las rutas como texto, y el servicio las resuelve al decidir: una raíz hija `/permitida/enlace` que es un enlace a `/etc` pasaba como más estrecha y luego daba acceso a `/etc`. Ahora resuelve los enlaces de las dos políticas antes de comparar; una raíz que no se puede resolver es una violación. De paso, una raíz padre alcanzada por un enlace ya contiene sus subcarpetas reales.

**El servidor de tools exige `authorize` o `policy` para toda tool que no declare `readOnly: true` ([ADR-0009](docs/adr/0009-lo-declarado-decide-el-efecto.md) punto 5, auditoría B-07).**

- **Antes:** solo una tool `destructive` exigía un gate. Una que escribe y no declara nada, o `readOnly: false`, quedaba abierta a cualquier cliente con el token del servidor.
- **Ahora:** `createToolServer`, `createToolRegistrar` (y por tanto `AgentMCPServer.directTools` de `mcp-server`) lanzan al construir si alguna tool no es `readOnly: true` y no hay `authorize` ni `policy`. El error dice qué tool y por qué.
- **Cambio de comportamiento:** un servidor con tools sin declarar ya no arranca. Declara `readOnly: true` en lo que solo lee, o pasa `authorize` / `policy`. `createFlowTools` servidas por MCP necesitan gate (start, pause y resume cambian cosas).

**La aprobación falla cerrada ([ADR-0010](docs/adr/0010-la-aprobacion-falla-cerrada.md)).** Auditoría externa del 2026-11-26, reproducida contra `dist/`.

- **B-01 / C-02:** un paso con `gate.approval: human` sin aprobador se **rechaza** (antes se aprobaba). Igual en `runFlow` (`approve`), `FlowRunner` de enterprise (`onApprovalRequired`) y `WorkflowRunner` de core.
- **B-02:** solo `'approve'` y `'approve_all'` aprueban, en `approverFromCallback` y `ApprovalGate`. `undefined`, un valor desconocido o una errata rechazan, con el motivo.
- **B-03:** un paso cuyo `gate` tiene `evaluator`, o criterios que no revisa una persona, falla antes de correr si `runFlow` no recibe `gate`. Con `approval: human`, los criterios los valora esa persona.
- **B-04:** un paso que pide una persona sigue pidiéndola aunque la política acepte un agente; si la política no acepta ninguna persona, se deniega.
- **B-14:** un `alwaysAsk` que lanza, o argumentos ilegibles, preguntan.
- **C-01:** `ComplianceGate.reject()` es definitivo: evaluar criterios después no devuelve el veredicto a `passed`.
- **B-06:** `mandateCovers` exige que `actions` y `resources` sean listas de nombres: un texto ya no cubre por subcadena.
- **B-16 (mandates):** `checkAssurance` solo acepta niveles propios: `'toString'` u otro nombre del prototipo ya no pasa un mínimo `high`.
- **Cambio de comportamiento:** un flujo con aprobación humana que corría sin aprobador ahora la rechaza. Pasa `approve`/`approvals` (`onApprovalRequired` en enterprise).
- Documentación: ADR-0009 (lo declarado decide el efecto), ADR-0010, ADR-0011 (error público e interno); ADR-0008 aceptado; registro en SPEC-0006, SPEC-0011, SPEC-0023 y SPEC-0041.

**`run_command` ve el código que se ejecuta en línea y las instalaciones escondidas (coding).** Auditoría externa del 2026-11-26.

- **E-01:** `npx -c`, `npm exec -c`, `git -c …` / `--config-env` (alias `!sh`, `core.pager`, `core.sshCommand`) y `make --eval` pasan a ser *bins* marcadores que ninguna allowlist tiene: el comando se rechaza nombrando la forma. `npm exec` / `x` / `dlx` y `npx` juzgan además el comando que corren (`npm exec -- sh -c …` ve `sh`).
- **E-02:** una asignación de una variable que un programa ejecuta o carga (`GIT_PAGER`, `GIT_SSH_COMMAND`, `EDITOR`, `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `PATH`, `npm_config_*`, `PYTHONPATH`…) es un marcador (`GIT_PAGER=`): antes se saltaba sin mirar su valor.
- **E-05:** la aprobación de instalación (`alwaysAsk`) cubre `xargs npm install` (lo que xargs lee cuenta como paquete nombrado), `find -exec npm install x`, `npx -y` / `npx -p` / `npx paquete@versión`, `pnpm dlx` / `yarn dlx` (antes no preguntaba), `npm exec --yes`, `bun add`, `uv pip install` / `uv add` / `uv tool install`, `poetry add`, `pipx install`, `cargo install`, `gem install` y `go install`. `npx tsc` (binario local) y `npm ci` (restaura lo declarado) siguen sin preguntar.
- **Límite (sin cambios):** la allowlist es una barandilla, no el confinamiento: un intérprete permitido (`node`, `python`, `npm run`) puede ejecutar cualquier cosa. El confinamiento es el sandbox.

## v0.50.21 (2026-11-26)

**El cliente MCP fija la definición de las tools y los hechos locales ganan a las anotaciones del servidor.**

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.16 | `pinnedTools`, `toolFacts`, `mcpToolFingerprint`, `toolFingerprints()` |

Se publica uno. Tag: `agent-core@0.49.16`. Aditivo: sin `pinnedTools` ni `toolFacts` nada cambia.

**Lo que un servidor MCP dice de sus tools ya no decide solo.** Dos huecos de confianza del cliente MCP (`MCPClientManager`), del análisis "una tool no es confiable porque declare ser segura".

- **`pinnedTools`:** `{ nombreDeLaTool: huella }`. Antes, un servidor podía cambiar la descripción, el esquema o las anotaciones de una tool entre conexiones (envenenamiento de tools: instrucciones nuevas en la descripción) y el modelo las recibía sin que nadie lo aceptara. Ahora, con pins, una tool cuya definición cambió se deja fuera con un aviso, y también una que no está en la lista: el servidor no puede añadir tools nuevas. La huella es el SHA-256 del JSON canónico de nombre, título, descripción, esquema y anotaciones; `_meta` queda fuera. `mcp.toolFingerprints(servidor)` y `mcpToolFingerprint(tool)` la dan para rellenar la config. Sin `pinnedTools`, nada cambia.
- **`toolFacts`:** hechos que declara el cliente, por nombre de la tool en el servidor. Ganan a las anotaciones del servidor, de confianza o no. Antes, con `trustAnnotations`, el servidor decidía el nivel de cada tool y no había forma de corregirlo sin dejar de confiar en todo el servidor: un `readOnlyHint: true` hacía que una tool de pago no pidiera nada, y un `destructiveHint: false` la sacaba de la aprobación solo humana (la cubría "aprobar todo"). Un `destructive: true` local quita `readOnly`; un `readOnly: true` local quita `destructive`; los dos a la vez se rechazan al construir el manager. Sirve también para confiar en una sola tool como de solo lectura sin `trustAnnotations`.
- Una clave de `toolFacts` que el servidor no lista (una errata, o el nombre con prefijo `mcp__erp__…`) se avisa al conectar: si no, el hecho que se quería imponer no se aplicaría sin que nadie lo viera.
- La documentación de `trustAnnotations` decía solo `readOnlyHint`: copia también `destructiveHint`, `idempotentHint`, `openWorldHint` y `_meta`.
- **Límite:** el pin comprueba lo que la tool dice, no lo que hace. Una tool local que declara `readOnly` y escribe sigue siendo un problema del código, no del framework.
- Pruebas: `MCPClientManager.pins.test.ts`.

## v0.50.20 (2026-11-26)

**El sandbox juzga cada tool por lo que declara, y el servidor de tools de core deja de enviar errores internos y sabe quién llama.** Hallazgos de la revisión de código del sandbox y del servidor de tools.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.15 | Hechos de la tool al sandbox, `ToolError`/`errorId` en el servidor de tools, identidad por llamada, aviso de `--token` |
| `agent-sandbox` | 0.1.24 | `read-only` por hechos, `ownStateTools`, raíces extra en Docker; peer `agent-core` >=0.49.15 |
| `agent-coding` | 0.32.14 | `ownStateTools` con sus tools de memoria, lecturas de auditoría `readOnly` |

Se publican tres, en ese orden (`agent-sandbox` necesita que el engine le pase los hechos: con un core anterior toda tool contaría como sin declarar). Tags: `agent-core@0.49.15`, `agent-sandbox@0.1.24`, `agent-coding@0.32.14`.

**Cuidado al actualizar:** en `read-only`, una tool sin `readOnly: true` ahora se rechaza; en `ask`, una tool sin declarar pide aprobación; y un error que no sea `ToolError` llega al cliente MCP como `internal error (<errorId>)`.

**El modo `read-only` del sandbox juzga cada tool por lo que declara, no por su nombre.** Hallazgo de la revisión de código del sandbox (2026-11-26).

- **Antes:** `read-only` solo rechazaba las tools listadas en `writeTools` (vacío por defecto). Una tool `destructive` (pagar, enviar un email), una tool MCP o una propia sin declarar corría igual.
- **Ahora:** en `read-only` solo corre lo que declara `readOnly: true`. Una tool `destructive`, o una que no declara nada, se rechaza: lo que no se conoce no se da por bueno. `approvalFor` clasifica igual: una tool sin declarar cuenta como una con efecto.
- **`SandboxRunner.authorizeTool` y `approvalFor`** reciben un tercer argumento, `facts` (`SandboxToolFacts`: `readOnly`, `destructive`). El engine los pasa en todos sus caminos (`executeToolCall`, `tool_search`, la aprobación por política y la heredada). Un runner al que se llama solo con el nombre recibe la tool como "sin declarar".
- **Nueva opción de la política `ownStateTools`:** tools que escriben solo el estado propio del agente (su memoria). Corren en `read-only` y nunca piden aprobación. Es una lista explícita, y una política hija solo puede eximir las que eximía la padre (`checkNarrower`).
- **`writeTools` se queda como refuerzo:** una tool listada se rechaza aunque declare `readOnly`.
- **Coding:** `buildCodingSandbox` pone sus tools de memoria en `ownStateTools` (`CODING_OWN_STATE_TOOLS`). `get_latest_audit` y `list_audits` declaran `readOnly: true`, y en core también `job_output` y `job_list`.
- **Cambio de comportamiento:** en `read-only`, una tool sin `readOnly: true` que antes corría ahora se rechaza; en `ask`, una tool sin declarar ahora pide aprobación. Declara los hechos de tus tools o nómbralas en `ownStateTools`.
- Pruebas nuevas: `AgentEngine.sandboxFacts.test.ts` (el engine pasa los hechos), y casos en `service.test.ts`, `inherit.test.ts` y el `sandbox.test.ts` de coding (cada tool de coding con sus hechos reales).

**El servidor de tools de core ya no envía al cliente el mensaje de un error interno.** Mismo contrato que `agent-protocol` 0.8.0, con el error tipado que core ya tenía.

- **Antes:** si una tool lanzaba un error, el cliente MCP recibía `Tool "x" failed: <mensaje>`, y el mensaje también iba a la auditoría (`reason`). Lo mismo con `authorize threw: <mensaje>` y `the approver failed: <mensaje>`.
- **Ahora:** un `ToolError(code, message)` es para el cliente: su mensaje viaja y la auditoría registra su `errorCode`, no el mensaje. Cualquier otro error es interno: el cliente recibe `internal error (<errorId>)` y el error va a la nueva opción `onInternalError(err, { errorId, server, tool, where, requestId })` (por defecto stderr), igual para `authorize` y el aprobador. El registro del hook `audit` (obsoleto) lleva el mensaje genérico.
- **Cambio de comportamiento:** para que el cliente vea por qué falló, lanza `ToolError`, o devuelve el fallo como resultado (lo devuelto es payload). Afecta también a las tools directas de `AgentMCPServer` (`mcp-server`), que usan el mismo registrador.

**El servidor de tools sabe quién llama.** Antes `authorize` y las políticas no recibían ningún dato del llamador, y con un token compartido todas las llamadas actuaban como la misma persona (`identity` fija). Ahora `ToolCallInfo` lleva las cabeceras de la petición HTTP (`headers`) y `authInfo`, que el SDK ya entregaba, e `identity` puede ser una función de la llamada: cada llamada actúa por quien la hizo, a partir de algo que el servidor verifica (un token personal). Una función que lanza deniega la llamada con un `errorId`. Aditivo: una `identity` fija funciona igual.

**`--token` del CLI del servidor de tools** avisa al arrancar de que el token queda visible para otros usuarios de la máquina (`ps`), y la ayuda recomienda `BK_MCP_TOKEN`.

**El backend Docker monta también las raíces extra de la política.** Un comando con el directorio de trabajo en una de `policy.roots`, fuera del workspace, pasaba la comprobación pero Docker solo montaba el workspace: corría en `/workspace/../<ruta>`, un directorio vacío que Docker crea dentro del contenedor, sin error. Ahora cada raíz se monta en `/roots/<n>` (en solo lectura en `read-only`) y el directorio de trabajo es el de dentro del montaje que lo contiene. Un `cwd` que no está en ninguno falla en vez de correr en el sitio equivocado. `BackendExecRequest` gana `roots`.

## v0.50.19 (2026-11-26)

**Seguridad: actualizar `agent-protocol` cuanto antes si se usa `controlApiKey`.** Además, `agent-core` cierra los huecos de delegación, abort y presupuesto de la revisión de código del engine, y los tres servidores con token bearer dejan de aceptar uno vacío.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.8.0 | Claves por ruta, `approverOf`, errores internos con `errorId`, Host/Origin en loopback |
| `agent-core` | 0.49.14 | `delegatesTo` y `ctx.askAgent` bajo control, abort y presupuesto, identidad en la delegación, delegación aprobada, `workflow_complete`, token vacío |
| `mcp-server` | 0.19.15 | Un token vacío no autoriza; `authToken` vacío no arranca |
| `mcp-connectors` | 0.2.7 | Un token vacío no autoriza; `authToken` vacío no arranca |

Se publican cuatro, en ese orden (`agent-core` necesita `agent-protocol` 0.8.0). Tags: `agent-protocol@0.8.0`, `agent-core@0.49.14`, `mcp-server@0.19.15`, `mcp-connectors@0.2.7`.

**Cuidado al actualizar:** los cambios de comportamiento de abajo (marcados) afectan a quien apruebe por el protocolo sin `approverOf`, a quien comunique fallos de negocio con un `Error` normal, a un agente por defecto con lista `delegatesTo`, a la delegación sin identidad y a `ctx.llmCall`.

**`agent-protocol`: las rutas de control exigen la clave de control en la propia ruta.** Actualizar cuanto antes si se usa `controlApiKey`.

- **Corregido:** la comprobación de claves se hacía aparte, comparando la URL, y algunas grafías de la URL de una ruta de control llegaban a ella sin la clave de control. Ahora cada ruta declara su clave (`runKey` o `controlKey`) como primer manejador, y la comprobación corre siempre que la ruta coincide.
- **No cambia:** qué clave abre cada ruta. Una ruta desconocida responde 404 también sin clave (antes, con `apiKey`, respondía 401).
- Pruebas nuevas (`route-keys.test.ts`): cada ruta de control con varias grafías, y una que falla si una ruta nueva no declara su clave.
- **Quién aprueba lo dice el servidor, no el body.** El `by` de `POST /v1/agent/approvals/:id/decision` lo declaraba el cliente, así que quien tuviera la clave de control podía aprobar como cualquier persona. Nueva opción `approverOf({ headers })`: devuelve el aprobador a partir de algo que el servidor verifica (un token personal); si no puede identificarlo, 401. Sin ella, quien decide es `CONTROL_KEY_APPROVER` (`{ kind: 'service', id: 'control-key' }`). El `by` del body pasa a ser opcional y, si viene y no coincide, 403. `decideApproval` del cliente acepta cabeceras extra para esa llamada. **Cambio de comportamiento:** sin `approverOf` no se puede aprobar como humano por el protocolo.
- **Los errores internos ya no viajan al llamador.** Cualquier error de una capability, de un handler o de la gate que no sea un `ControlError` o el nuevo `CapabilityError` (los pensados para el llamador) responde `EXECUTION_FAILED` con un mensaje genérico y `details.errorId`. El error real va a la nueva opción `onInternalError(err, { errorId, where, traceId })` (por defecto `console.error`) con el mismo id. Antes viajaba su mensaje, que puede llevar rutas, consultas o credenciales. **Cambio de comportamiento:** para comunicar un fallo de negocio al llamador, lanza `CapabilityError(code, message, details?)`. Los errores de core pensados para el llamador ya se llaman `ControlError` y siguen viajando.
- **En loopback y sin `apiKey`**, el servidor solo atiende peticiones cuyo `Host` y `Origin` sean loopback (como `agent-web` y el servidor de tools de `agent-core`): una página web abierta en el navegador ya no le llega mediante un nombre DNS que apunte a 127.0.0.1. Con `apiKey` no cambia nada.

**Un token vacío ya no autoriza a nadie ni arranca un servidor sin autenticación.** Hallazgo de la revisión de Steward (ADR-0015, «No verificado»).

- **`isBearerAuthorized('Bearer ', '')` devolvía `true`:** un valor de cabecera vacío coincidía con un token vacío. Ahora un token vacío no autoriza a nadie. Lo mismo en `isAuthorized` (`mcp-server`) e `isBearerAuthorized` (`mcp-connectors`), que tenían la misma copia.
- **Un `authToken` vacío (una variable sin definir, un fichero vacío) arrancaba el servidor sin autenticación y sin aviso:** ahora `startToolServerHttp`, `AgentMCPServer.start` y `startHttp` lanzan `authToken is empty`. Omitir el token sigue permitido solo en loopback.
- **Documentado:** en loopback y sin token el servidor de herramientas **no autentica** (cualquier proceso de la máquina lo puede llamar); la guarda contra el navegador es solo de `Host` y `Origin`. Con herramientas que tienen efecto, dar siempre un token.
- Pruebas nuevas en los tres paquetes; quitar el arreglo en `core` rompe dos.

**`delegatesTo` se aplica, y un abort para las tools pendientes de un sub-agente.** Hallazgos de la revisión de código del engine (2026-11-26).

- **`delegatesTo` era decorativo:** el agente por defecto podía delegar con `ask_agent` en cualquier agente registrado, aunque su perfil diera una lista. Ahora, con una lista, una delegación fuera de ella se rechaza, se audita como `not_allowed` y no llega ni a las políticas ni al agente. El roster del prompt muestra solo esos agentes. **Cambio de comportamiento:** revisa las listas de tu agente por defecto.
- **No cambia:** sin lista o con lista vacía, el agente por defecto sigue pudiendo delegar en todos; `['*']` igual. Un agente que registra un servidor MCP en `mode: 'agent'` siempre es alcanzable. Solo el agente por defecto recibe `ask_agent`.
- **El mensaje de tool no autorizada** ya no le dice a un especialista que use `ask_agent`, una tool que no tiene.
- **Abort en un sub-agente:** `abort()` (también por presupuesto con `abortOnBudget`) cortaba la llamada al LLM y las tools en curso, pero las tools que quedaban de esa vuelta empezaban igual. Ahora no empiezan.
- **`ctx.askAgent` (delegación desde una tool) no pasaba ningún control:** ni auto-delegación, ni `delegatesTo`, ni identidad, ni políticas, ni auditoría. Ahora pasa el mismo control que `ask_agent` y deja un evento `ask_agent` en la auditoría. Si lo rechaza, lanza, y la tool falla con el motivo. **Cambio de comportamiento:** una tool de un agente que no es el agente por defecto y no tiene `delegatesTo` ya no puede delegar.
- **Abort mientras una tool espera al aprobador:** si la aprobación llegaba después del abort, la tool corría igual. Ahora no empieza; se audita como permitida, con `outcome: 'aborted'` y la aprobación.
- **`ctx.llmCall` y `callLLM` no contaban en el presupuesto:** no emitían el evento `metrics` (de donde salen el coste y el presupuesto) ni recibían el abort. Ahora emiten `metrics` (`purpose: 'tool_llm_call'` / `'call_llm'`), se cortan con `abort()` durante una corrida y fallan con el error del proveedor. **Cambio de comportamiento:** `ctx.llmCall` antes se tragaba el error y devolvía `''`; ahora lanza. `callLLM` se quedaba colgada si el proveedor rechazaba en vez de llamar a `onError`.
- **`workflow_complete` anunciaba `failed`** para un flow suspendido esperando aprobación o cancelado. Ahora lleva el estado real; el tipo del evento suma `awaiting_approval` y `cancelled`.
- **Delegación sin políticas:** no comprobaba la identidad del agente (SPEC-0044), a diferencia de cualquier llamada a tool. Ahora sí, en `ask_agent` y en `ctx.askAgent`. **Cambio de comportamiento:** sin `agentIdentity` (y sin `requireAgentIdentity: false`) ya no se delega.
- **Abort en la ruta MCP directa:** una tool cuya aprobación llegaba tras el abort también corría ahí. Ahora se corta en cualquier camino de la corrida.
- **REFERENCE de `agent-core`:** el ejemplo de `DelegationBus` usaba métodos que no existen (`register`, `delegate`). Ahora usa la API real (`runSingle`, `runParallel`).
- **Una delegación aprobada desde el store nunca corría:** con una política que pide aprobación para `ask_agent` y un store de `approvals`, `runApproved` buscaba `ask_agent` en el registro de tools, donde no está, y gastaba la aprobación sin delegar. Ahora la delegación se vuelve a comprobar con la aprobación guardada, se ejecuta y se audita con la aprobación. Una delegación aprobada en vivo también registra ahora quién la aprobó.
- Pruebas nuevas (`AgentEngine.delegatesTo.test.ts`, `AgentEngine.ctxAskAgent.test.ts`, `AgentEngine.subAgentAbort.test.ts`, `AgentEngine.singleCall.test.ts`, `workflow-complete-status.test.ts`, `AgentEngine.approvedDelegation.test.ts`); quitar el arreglo rompe diecinueve.

## v0.50.18 (2026-11-25)

**Un paso de un flow puede ser una llamada a una herramienta (SPEC-0046 F1).** Es el paso `tool` que la SPEC-0023 D2 aceptó y no se había construido. Aditivo: un flow sin `kind` se ejecuta igual que antes.

- **`FlowStep.kind` (`'agent' | 'tool'`) y `FlowStep.tool` (`{ name, args? }`).** El `prompt` sigue siendo obligatorio y, en un paso de herramienta, solo lo describe. `validateFlow` rechaza un `kind: tool` sin `tool` y un `tool` sin `kind: tool`.
- **`StepInput.tool` y `StepInput.outputs`.** El executor recibe la llamada con `{{payload.x}}` resuelto en los argumentos (una referencia entera conserva su tipo) y los resultados estructurados de los pasos de los que depende. Core no valida los argumentos: no conoce ninguna herramienta.
- **`StepOutput.data`.** El resultado estructurado; con `content` vacío, `content` pasa a ser `JSON.stringify(data)`. No cambia el journal: tras reanudar, los datos de un paso de herramienta se leen de su texto.
- **No cambia:** ningún campo existente, el esquema de los journals, `when` ni la forma de `FlowStepSchema` (sigue siendo un objeto).
- **Aprobación de un paso de herramienta.** La solicitud lleva la llamada (`subject.tool`, con `redact`) y su digest (`subject.callDigest`); al reanudar, una llamada distinta de la aprobada falla sin ejecutarse. Con `approvals.when: 'after'` un paso de herramienta falla sin ejecutarse. La política de `flow.step:<id>` recibe los argumentos de la llamada. Un paso de agente queda igual.
- **Documentación al día:** README y REFERENCE de `agent-core` (aprobaciones por rol y cuatro ojos, caducidad, orden de la lista, campos de auditoría, mandatos atados a identidad, medidas) y README de `agent-providers` (guarda de silencio del stream y nota de truncado), hasta `agent-core` 0.49.12.
- **Cuidado al publicar:** un `agent-core` anterior descarta `kind` y `tool` al cargar y ejecutaría el paso como un prompt. Un flow con pasos de herramienta debe cargarse con una versión que los conozca.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.13 | El paso de herramienta de un flow (`kind: tool`), aprobado para la llamada que corre |
| `agent-providers` | 0.3.18 | Solo README al día (sin cambio de código) |

Se publican dos, en ese orden. Tags: `agent-core@0.49.13`, `agent-providers@0.3.18`.

## v0.50.17 (2026-11-24)

**`FileApprovalStore.list` da siempre el mismo orden.** Ordenaba por `createdAt` (precisión de milisegundo) y, ante un empate, el orden lo daba `readdir`, que no tiene ninguno propio: dos solicitudes creadas en el mismo milisegundo salían en un orden que dependía del sistema de ficheros. Quien tomaba «la última de la lista» como «la que acabo de crear» leía a veces la otra. Lo notamos por una prueba intermitente del CI (`approval-expiry`).

- **Desempate por `id`:** más antigua primero, y a igual `createdAt` por `id`. El orden es el mismo en cada llamada y en cualquier sistema de ficheros.
- **Documentado en el contrato** (`ApprovalStore.list`): el orden entre solicitudes del mismo milisegundo es estable pero **no cronológico**; para saber cuál has creado, compara los `id` que ya conocías. `MemoryApprovalStore` ya devolvía el orden de inserción.
- Una prueba nueva fuerza el empate y un `readdir` al revés, y una mutación (quitar el desempate) la rompe.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.12 | `FileApprovalStore.list` con orden estable |

Se publica uno. Tag: `agent-core@0.49.12`.

## v0.50.16 (2026-11-24)

**`AgentClient` puede llevar el token personal que lee la puerta del servidor.** Hallazgo del ejemplo `portfolio-advisor`: `capabilityIdentityGate` dice que la persona de una ejecución debe salir de algo que el servidor verificó (un token), y el servidor lee cualquier cabecera, pero el cliente solo sabía enviar `apiKey` y `tenantId`: no había forma de mandar ese token con el cliente del propio paquete.

- **`AgentClientOptions.headers`:** cabeceras que viajan en cada llamada.
- **`RunOptions.headers`** (`run`, `runAndWait`) y el cuarto parámetro de **`startFlow`**: cabeceras de una sola llamada, que reemplazan a las del cliente solo en esa llamada (un cliente sirve a muchas personas: su token viaja con su llamada, sin filtrarse a la siguiente).
- **Lo que es del cliente no se reemplaza:** `Authorization` (lo pone `apiKey`), `Content-Type`, `Content-Length` y `Host`, en cualquier capitalización, se **rechazan** (al construir el cliente o al llamar), antes de enviar nada. Una cabecera que pisara la clave del protocolo sería un fallo silencioso.
- 5 pruebas nuevas (98 en el paquete) y cuatro mutaciones que las rompen. Cambio compatible: nada cambia si no se usa `headers`.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.7.3 | `headers` en el cliente, en `run`/`runAndWait` y en `startFlow` |

Se publica uno. Tag: `agent-protocol@0.7.3`.

## v0.50.15 (2026-11-24)

**SPEC-0045 F2: las medidas viajan en una credencial.** El tipo `Mandate` ya sabía de `limits.measures` (0.49.11), pero ninguna credencial podía llevarlas: el verificador de referencia rechazaba lo que no conocía.

- **Perfil `vct` 2 (agent-mandates 0.1.5):** `urn:backendkit:mandate:2` = el primero más `limits.measures` (`[{ name, max, unit? }]`). El verificador acepta **los dos perfiles por defecto** y lee las medidas solo bajo el segundo. Valida cada medida: nombre (`^[a-z][a-z0-9_]{0,31}$`, no `amount`, sin repetir), máximo (número, no negativo), unidad (texto no vacío) y rechaza cualquier clave que no conozca dentro de una medida.
- **Una medida nunca se acepta y se descarta:** una credencial del perfil 1 con `measures` se **rechaza** (y el motivo dice que necesita el perfil 2); un verificador que solo conoce el perfil 1 **rechaza** una credencial del perfil 2 (ya comprueba el `vct`); y `issueMandate` emite el perfil 2 por sí solo si hay medidas, y **lanza** si se le pide el perfil 1 con medidas.
- **Kit de adaptadores:** `Power.measures` se valida en `checkPowers` (la misma validación). Un adaptador que quiera usarlas las traduce; una restricción que no traduce se sigue rechazando.
- **Ruptura de rango:** `agent-mandates` 0.1.5 exige `agent-core` >= 0.49.11 (antes >= 0.49.5). Con un core anterior las medidas se ignorarían al comprobar cada llamada, que es exactamente lo que este diseño no permite.

| Paquete | Versión | |
|---|---|---|
| `agent-mandates` | 0.1.5 | perfil `vct` 2 con `limits.measures`; depende de `agent-core` >= 0.49.11 |

Se publica uno. Tag: `agent-mandates@0.1.5`.

## v0.50.14 (2026-11-24)

**SPEC-0045 F1: el apoderamiento limita cualquier cantidad medible de una llamada crítica, y se exige solo a lo que el operador diga.** Hasta ahora el «hasta cuánto» de un apoderamiento solo sabía medir un importe con moneda, y `mandatePolicy` pedía apoderamiento a **toda** llamada (hasta a leer y a delegar).

- **`limits.measures` y `measureOf` (agent-core 0.49.11):** una lista de `{ name, max, unit? }`, un máximo **por operación** sobre una magnitud que la aplicación sabe leer de la llamada (`measureOf: { rows: (args) => ({ value, unit }) }`). Como el importe: una medida que la política no sabe leer, o que la llamada no dice, deja la llamada **fuera del alcance** (pregunta a una persona, o se deniega con `outOfScope: 'deny'`). Un tope mal escrito (nombre no válido o repetido, `amount` como nombre, un máximo que no es un número, una unidad inválida) no cubre nada.
- **`appliesTo` y `otherwise`:** `appliesTo: (tool) => boolean` dice a qué herramientas se exige apoderamiento; **las demás las decide `otherwise`** (por defecto la política por defecto del framework: lo de solo lectura corre, lo destructivo pregunta a una persona, lo no declarado pregunta) y **el verificador ni se consulta**. Olvidar una herramienta crítica es molesto, nunca permisivo. Un `appliesTo` que lanza deniega. **Sin `appliesTo` nada cambia: se exige a todas.**
- **No hay credenciales con medidas todavía:** el verificador de referencia de `agent-mandates` rechaza lo que no conoce (0.1.4). Las medidas viajarán en un perfil nuevo (`vct 2`, F2 de SPEC-0045); hasta entonces solo las produce un verificador o un adaptador propio.
- **Documentación:** la página de gobernanza explica que el apoderamiento es para lo crítico y cómo se limita.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.11 | `limits.measures`, `measureOf`, `appliesTo`, `otherwise` |

Se publica uno. Tag: `agent-core@0.49.11`.

## v0.50.13 (2026-11-24)

**El verificador de referencia de `agent-mandates` deja de ignorar en silencio las restricciones que no conoce.** Se comprobó ejecutando: una credencial con `limits: { amount, rows: { max: 5 } }` se aceptaba y el apoderamiento resultante tenía **solo** el importe; la restricción `rows` desaparecía y el agente podía más de lo que el emisor quiso. Lo mismo con cualquier clave desconocida del claim `mandate` (`validBetween`, `maxPerDay`...) o dentro de `amount` (`per: 'day'`). Es lo contrario de lo que ya hace el kit de adaptadores (`checkPowers`): fallar cerrado ante lo que no se sabe aplicar.

- **agent-mandates 0.1.4:** el verificador **rechaza** la credencial si el claim `mandate`, `limits` o `amount` llevan una clave que el perfil no conoce, y el motivo dice cuál. Una credencial con solo lo que el perfil conoce sigue pasando igual.
- **Ruptura leve, por la misma razón que antes (no hay usuarios externos):** una credencial emitida con claves de más, que antes se aceptaba perdiendo esas restricciones, ahora se rechaza.

| Paquete | Versión | |
|---|---|---|
| `agent-mandates` | 0.1.4 | rechaza restricciones desconocidas en vez de ignorarlas |

Se publica uno. Tag: `agent-mandates@0.1.4`.

## v0.50.12 (2026-11-24)

**Una advertencia al arrancar cuando la identidad del agente es autoafirmada.** Un agente sin proveedor de identidad funciona (`selfAssertedIdentities()`) y la auditoría ya lo marca `assurance: 'self-asserted'`, pero quien arrancaba el agente no se enteraba salvo leyendo el registro.

- **agent-core 0.49.10:** la **primera llamada** de un motor, un servidor de herramientas o un servidor de capacidades con una identidad autoafirmada escribe un aviso: «runs with a self-asserted identity (nobody vouches for who it is): enough to develop, not for a regulated environment or to prove to a third party who acted». Una vez por motor o servidor, no por llamada ni por agente. En el motor es un evento `system` de nivel `warn` del transporte; en los servidores, una línea en stderr. También salta con una identidad firmada con claves propias (`ed25519AgentIdentities`), que sigue sin estar respaldada por nadie, y con `requireAgentIdentity: false` si hay identidad. No salta si la identidad tiene otro nivel de garantía, ni cuando la llamada se rechaza de todos modos, ni **bajo un ejecutor de pruebas (`NODE_ENV=test`)**, donde sería ruido en cada ejecución.
- **Efecto visible:** quien ejecute un agente con `selfAssertedIdentities()` fuera de pruebas verá una línea de aviso. Es lo esperado y no cambia lo que corre.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.10 | aviso de identidad autoafirmada |

Se publica uno. Tag: `agent-core@0.49.10`.

## v0.50.11 (2026-11-24)

**La misma regla de aprobación en todos los caminos: roles, cuatro ojos y registro.** Hasta ahora solo el motor imponía `approverRoles` y `forbidSelfApproval`. Se comprobó ejecutando que **un flujo, el manejador de decisiones y el servidor de herramientas directas aceptaban a un becario y a quien había hecho la petición**, aunque la política pidiera un rol: la comprobación estaba copiada tres veces y se había desalineado. Lo encontró el ejemplo `portfolio-advisor`.

- **`checkApproval` (agent-core 0.49.9):** una sola función (tipo de aprobador, nadie se aprueba a sí mismo, cuatro ojos y rol contra el directorio) que usan el motor (en proceso y con aprobación guardada), el flujo, `createApprovalHandler` y `createToolServer`. Está exportada.
- **Opciones nuevas:** `approverDirectory` y `forbidSelfApproval` en `approvals` de `runFlow`, en `createApprovalHandler` y en `createToolServer` (y en `directTools` de `AgentMCPServer`, mcp-server 0.19.14, que las reenvía). La solicitud de un paso de flujo y la del servidor llevan ahora los `approverRoles` del `ask`.
- **El flujo comprueba otra vez al continuar:** una decisión tomada en otro proceso (un supervisor, un script que escribe en el almacén) se valida contra los roles de la política de ahora y el directorio de ahora. Antes bastaba con que alguien dijera que sí.
- **`approval.reason` en el evento:** el motivo que dio quien aprobó (SPEC-0014 §6.2 regla 4 lo pedía y no se guardaba), en el motor, con aprobación guardada y en el servidor de herramientas. El servidor registra además `authority`, `reason` y `exceeded`, como el motor.
- **Prueba de conformidad:** los mismos cinco escenarios (finanzas aprueba; un becario, el solicitante, un desconocido y la ausencia de directorio, no) pasan por los cinco caminos. Quitando la comprobación de un camino a la vez, falla ese camino.

**Ruptura, por la misma razón que antes (no hay usuarios externos; decisión del autor):** un `ask` con `approverRoles` en un flujo, un manejador o un servidor de herramientas **sin directorio** pasa a **denegarse** (antes se aprobaba sin comprobar). Con `forbidSelfApproval` y sin `identity.userId`, el flujo, el manejador y el servidor **rechazan** (antes la regla no hacía nada). Una aprobación pendiente decidida antes de actualizar por alguien sin el rol se rechaza al continuar el flujo. El motor mantiene lo documentado: con `forbidSelfApproval` y sin `userId` la regla no hace nada, porque el motor ya exige `identity.userId` por defecto.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.9 | `checkApproval`; `approverDirectory` y `forbidSelfApproval` en flujo, manejador y servidor de herramientas; `approval.reason` |
| `mcp-server` | 0.19.14 | reenvía las dos opciones en `directTools`; depende de `agent-core` ^0.49.9 |

Se publican dos. Orden: `agent-core`, `mcp-server`. **`agent-core` 0.49.8 no hace falta publicarla** (0.49.9 la incluye). Tags: `agent-core@0.49.9`, `mcp-server@0.19.14`.

## v0.50.10 (2026-11-24)

**El registro de una llamada aprobada dice por qué se pidió a una persona y, si fue por salirse de un apoderamiento, de cuál.** Hasta ahora el evento de una orden aprobada llevaba quién aprobó y con qué rol, pero ni el motivo (`reason`) ni el apoderamiento: quien lo leyera no podía ver que la orden **superaba el límite** de ese poder. Lo encontró el ejemplo `portfolio-advisor`.

- **`reason` en el evento aprobado (agent-core 0.49.8):** el motivo del `ask` (por ejemplo «outside the mandate: the amount 6000 is above the 5000 the mandate allows») ya no se pierde cuando alguien aprueba. Vale para cualquier política, no solo para apoderamientos.
- **`exceeded` en el evento:** el apoderamiento que la llamada **no** cubría (mismos campos que `mandate`, con el hash de la credencial). `mandatePolicy` lo pone en el `ask` (`exceeds`) y `combineDecisions` lo conserva. **No va en `mandate`**: ese campo dice «actuó cubierto por este poder» y sería falso. Está bajo la firma del agente.
- **Límite que se corrige en 0.49.9:** el servidor de tools directas (`createToolServer`) no registraba esto, y tampoco **imponía** roles ni cuatro ojos (ver v0.50.11).

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.8 | `AuditEvent.exceeded`, `PolicyDecision.ask.exceeds`, `reason` en las llamadas aprobadas |

Se publica uno. Tag: `agent-core@0.49.8`.

## v0.50.9 (2026-11-23)

**Una orden fuera del apoderamiento puede exigir un rol de quien la aprueba.** El `ask` de `mandatePolicy` para lo que el apoderamiento no cubre no llevaba `approverRoles`, así que el motor aceptaba a **cualquier persona que no fuera quien la pidió**: un becario podía aprobar una orden por encima del límite. Lo encontró el ejemplo `portfolio-advisor` (con una prueba que lo demostraba).

- **`outOfScopeApprover` (agent-core 0.49.7):** `mandatePolicy({ outOfScopeApprover: { approverRoles, accepts, ttlSeconds } })` copia esos campos al `ask`. El motor comprueba los roles en el `approverDirectory`, nunca en lo que diga quien llama; sin directorio, o con una persona que nadie conoce, no se acepta la aprobación. Sin la opción nada cambia. Una regla mal escrita (sin roles, un rol vacío, un tiempo no positivo) falla al construir la política, no se convierte en «cualquiera» ni en «nadie» en silencio. Con `outOfScope: 'deny'` no tiene efecto.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.7 | `outOfScopeApprover` en `mandatePolicy` |

Se publica uno. Tag: `agent-core@0.49.7`.

## v0.50.8 (2026-11-23)

**Un apoderamiento atado a otra identidad de agente se deniega; ya no «pide a una persona».** En 0.49.5, `mandatePolicy` trataba un apoderamiento que nombra otra identidad como «fuera de alcance», y el valor por defecto de «fuera de alcance» es pedir aprobación: una persona podía aprobar con un apoderamiento que no era de ese agente. Ahora es un rechazo (`no valid mandate: the mandate is bound to another agent identity`), igual que sin credencial. Lo encontró la refactorización del ejemplo `mandate-agent` al pasar a lo nativo.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.6 | `mandatePolicy` deniega un apoderamiento de otra identidad (o de un agente sin identidad) |

Se publica uno. Tag: `agent-core@0.49.6`.

## v0.50.7 (2026-11-23)

**Se retira el paquete `@backendkit-labs/codemod`.** Nadie lo usa y se decidió no mantenerlo (SPEC-0037). Se borra `packages/codemod` del repositorio y del CI; la versión publicada (0.1.0) se deprecará en npm, no se despublica. La guía [migrar entre versiones](site/src/content/docs/guides/migrate-between-versions.md) ya no remite al codemod: para cada ruptura dice qué cambiar a mano. No cambia ningún otro paquete.


## v0.50.6 (2026-11-23)

**F3 de SPEC-0044: el apoderamiento queda atado a la identidad del agente, y la posesión de la clave se prueba en cada llamada.** Hasta ahora un apoderamiento era una cadena que servía a quien la tuviera. Ahora puede nombrar la identidad del agente al que se emitió y estar atado a su clave: sin la clave, no vale.

- `Mandate.agentIdentity` y `mandateCovers` (agent-core 0.49.5): si el apoderamiento nombra una identidad, solo cubre al agente cuya identidad, resuelta por su proveedor, es esa. Una credencial emitida a otro agente no es «fuera de alcance»: no es ningún poder.
- `MandateRequest.prove` (agent-core 0.49.5): `mandatePolicy({ agentIdentity })` da al verificador una función que firma un reto con la clave de la identidad del agente. El verificador construye el reto para **esa** verificación y comprueba la firma con la clave de la credencial.
- `Mandate.holderBinding` y `AuditMandate`: la auditoría dice `proven` cuando el agente probó que tiene la clave y `none` cuando la credencial es al portador, y qué identidad de agente nombraba. `requireHolderBinding: true` en `mandatePolicy` rechaza las credenciales al portador (por defecto se aceptan y quedan marcadas `none`).
- **Verificador de referencia (agent-mandates 0.1.3):** admite credenciales atadas a una clave (`cnf`, RFC 7800, Ed25519). Construye un Key Binding JWT con su audiencia, un nonce nuevo y la credencial, el agente lo firma y el verificador lo comprueba. Sin prueba, o con la firma de otra clave, rechaza. `issueMandate` acepta `holderKey` y `agentIdentity`.
- **Cuestionario para el equipo de Identidad:** `docs/specs/SPEC-0044-cuestionario-equipo-identidad.md` lista lo que falta para sustituir el formato del sistema compatible con eIDAS 2 que hoy se asume.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.5 | `agentIdentity` y `holderBinding` en el apoderamiento, `prove` en la petición, `agentIdentity` y `requireHolderBinding` en la política |
| `agent-mandates` | 0.1.3 | verificador de referencia con credenciales atadas a una clave |

Se publican dos. Orden: `agent-core`, `agent-mandates`. Tags: `agent-core@0.49.5`, `agent-mandates@0.1.3`.

## v0.50.5 (2026-11-23)

**El servidor de capacidades de `agent-protocol` también exige identidad (SPEC-0044): cierra el último camino que ejecutaba trabajo sin ella.** `AgentServer` corre capacidades y flujos para llamadores remotos con una sola clave compartida, sin saber para quién ni bajo qué identidad.

- **`gate` (agent-protocol 0.7.2):** una función `CapabilityGate` decide cada ejecución (`POST /run` y el inicio de un flujo) antes de que empiece, puede añadir al contexto del handler `userId` y `agentIdentity`, y se entera de cómo termina (`finish`). **Sin gate el servidor no ejecuta nada** (403 `FORBIDDEN` con un motivo que dice cómo arreglarlo); `allowUngated: true` es solo para pruebas. Un gate que lanza o devuelve algo que no es una respuesta rechaza: nunca significa «déjalo pasar». El protocolo no depende de ningún proveedor de identidad.
- **`capabilityIdentityGate({ name, agentIdentity, identity })` (agent-core 0.49.4):** el gate con la misma regla y el mismo valor por defecto que el motor: identidad del agente y para quién actúa, o se rechaza; un evento de auditoría por ejecución, atribuido a la identidad y firmado si el proveedor firma (`auditSink`, `signAuditEvents`). Como la clave compartida no dice quién llama, **para quién es la ejecución lo dices tú**: una `identity` fija o una función de la llamada, construida con algo que hayas verificado, nunca con `x-tenant-id`, que pone el llamador.
- **Sesiones web (agent-web 0.6.18):** `EngineFactory` recibe un tercer argumento `caller: { userId? }` con la persona que el servidor autenticó (el `sub` del token), para que el motor de esa sesión actúe a nombre de ella. `agent-enterprise` 0.11.9 lo usa como `identity.userId`.
- **Ruptura:** todo `AgentServer` de agent-protocol sin gate pasa a rechazar las ejecuciones. Va como parche por la misma razón que antes: no hay usuarios externos (decisión del autor). Con esto, **todas las vías que ejecutan una tool o una capacidad exigen identidad**: el motor, el servidor de tools directas y el servidor de capacidades.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.7.2 | `gate` y `allowUngated` en `AgentServer`; `userId` y `agentIdentity` en el contexto |
| `agent-core` | 0.49.4 | `capabilityIdentityGate`; depende de agent-protocol ^0.7.2 |
| `agent-web` | 0.6.18 | la fábrica de motores recibe quién abrió la sesión |
| `agent-enterprise` | 0.11.9 | usa a esa persona como `identity.userId` |

Se publican cuatro. Orden: `agent-protocol`, `agent-core`, `agent-web`, `agent-enterprise`. Tags: `agent-protocol@0.7.2`, `agent-core@0.49.4`, `agent-web@0.6.18`, `agent-enterprise@0.11.9`.

## v0.50.4 (2026-11-23)

**La vía directa de herramientas también exige identidad (SPEC-0044): no queda ningún camino para ejecutar una tool sin ella.** `createToolServer` (y `startToolServerHttp`, `runToolServer`, `createToolRegistrar`) ejecutaba tools sin motor, y por tanto sin la exigencia que `agent-core` 0.49.0 puso al motor. Ahora aplican la misma regla y el mismo valor por defecto:

- **Identidad del servidor y a nombre de quién actúa:** `agentIdentity` (el mismo `AgentIdentityProvider`) e `identity.userId`. Sin ellos **cada llamada se deniega**, antes de `authorize` y de la política, con un motivo que dice cómo arreglarlo. `requireAgentIdentity: false` queda para pruebas (avisa una vez por stderr). Un proveedor que falla o no contesta en `agentIdentityTimeoutMs` deniega la llamada, también con el opt-out.
- **Auditoría:** cada evento de `auditSink`, permitido o denegado, lleva `agentIdentity` (o `agentIdentityMissing`) y lo firma la identidad del servidor si su proveedor puede firmar (`signAuditEvents: false` para no firmar); una custodia que no puede firmar deja el evento marcado `agentSignatureFailed`.
- **`AgentMCPServer` (mcp-server)** reenvía las mismas opciones para sus `directTools`; las herramientas de prompt corren en un motor, que ya tenía la regla.
- **Ruptura:** todo servidor de tools directas sin identidad pasa a denegar. Es la misma ruptura declarada en 0.49.0, ahora completa; no hay usuarios externos (decisión del autor), por eso va como parche. La identidad de un servidor es la del servidor, una por servidor, no una por cliente MCP.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.3 | identidad obligatoria, atribución y firma en la vía directa de herramientas |
| `mcp-server` | 0.19.13 | reenvía las opciones de identidad a sus `directTools` |

Se publican dos. Orden: `agent-core` primero. Tags: `agent-core@0.49.3`, `mcp-server@0.19.13`.
## v0.50.3 (2026-11-23)

Corrección en `agent-core` 0.49.2: **un worker que reanuda una aprobación guardada actúa a nombre de quien la pidió.** Con la identidad obligatoria (0.49.0), un motor sin `identity.userId` propio, como el worker que corre `runApproved` más tarde (SPEC-0041 F2), se denegaba con «no dice a nombre de quién actúa», aunque la petición guardada ya registra quién la hizo. Ahora usa ese `requestedBy` y la auditoría lo anota. Sigue exigiendo que el agente tenga identidad: la aprobación no la sustituye. No lo cazaron las pruebas porque casi todas se pasaron a `requireAgentIdentity: false`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.2 | el worker de una aprobación guardada actúa a nombre de quien la pidió |

Se publica uno. Tag: `agent-core@0.49.2`.

## v0.50.2 (2026-11-23)

**Cada evento de auditoría lo firma la identidad que ejecutó la llamada (SPEC-0044 F2).** Es aditivo: sin un proveedor que firme, nada cambia.

- **`sign` en el proveedor** (opcional, asíncrono: la clave puede estar en un KMS o un HSM). El motor firma cada evento con la identidad que lo ejecutó y **espera la firma**; `signAuditEvents: false` registra solo la identidad. Si la identidad no puede firmar (falla, tarda más del límite o devuelve algo que no es una prueba), el evento se escribe igualmente, marcado `agentSignatureFailed`: un registro perdido es peor que uno sin firmar, y un verificador nunca lo da por firmado.
- **Verificar:** `verifyAuditChain(ruta, { agentSignatures })` y `verifyAuditBundle(dir, { agentSignatures })` comprueban que cada evento está firmado por la clave de la identidad que nombra, con las claves públicas que TÚ tienes, nunca las del propio registro. Reescribir todo el registro y recalcular la cadena no basta: la firma cubre el contenido.
- **La prueba es opaca:** `core` verifica Ed25519 y registra la etiqueta `format` de cualquier otra; los demás formatos los verifica la pieza que el operador registra en `formats`. Un formato sin verificador **no pasa por verificado**. `core` no conoce ningún marco legal.
- **Proveedor de referencia que firma:** `ed25519AgentIdentities({...})`, con una clave Ed25519 por agente y `publicKeyOf(kid)`.
- **`CheckpointSigner.sign`** puede devolver una `Promise` (aditivo): `HashChainAuditSink.checkpointAsync()` y la firma automática cada N eventos la esperan. `checkpoint()` sigue siendo síncrono y avisa si el firmante no lo es.
- **Coste medido** (Ed25519 local, Node 22, esta máquina): construir el mensaje y firmar un evento cuesta **~0,1 ms**; verificarlo, **~0,4 ms**. Una custodia remota suma su latencia a cada llamada, porque el motor espera la firma: si no cabe en el presupuesto, `signAuditEvents: false` y un firmante asíncrono de checkpoints cada N eventos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.1 | firma de eventos por la identidad, verificación y firmante de checkpoints asíncrono |

Se publica uno. Tag: `agent-core@0.49.1`.

## v0.50.1 (2026-11-23)

Los agentes del repositorio llevan identidad y persona (SPEC-0044 F4). `createCodingEngineFromConfig`, la vía sin configuración del agente de código, da por defecto una identidad autoafirmada y actúa a nombre de quien lo ejecuta (`BK_AGENT_USER`, si no el usuario del sistema); lo que se pase como opción manda. `createCodingEngine` sigue exigiendo que se diga.

| Paquete | Versión | |
|---|---|---|
| `agent-coding` | 0.32.13 | identidad por defecto en `createCodingEngineFromConfig`; prueba que guarda el reenvío de las opciones de identidad |

Se publica uno. Tag: `agent-coding@0.32.13`. Los ejemplos (`aval-scheduler`, `git-agent`, `git-analyst`, `vault-pilot`) pasan a `agent-core` 0.49 con identidad y persona.

## v0.50.0 (2026-11-23)

**Ruptura en `agent-core`: un agente lleva identidad digital y dice a nombre de quién actúa (SPEC-0044 F1).** Sin las dos cosas, cada llamada a una tool se deniega con un motivo que dice cómo arreglarlo. No hay periodo de transición (decisión del autor): el framework está en desarrollo y se usa la última versión.

- **`agentIdentity`** (opción del motor): un `AgentIdentityProvider` da a cada agente su identidad. `core` no conoce ningún proveedor ni formato. Referencias: `staticAgentIdentities({...})` y `selfAssertedIdentities()`, ambas marcan la identidad `assurance: 'self-asserted'` para que la auditoría distinga una identidad respaldada de una escrita por el desarrollador.
- **A nombre de quién:** `identity.userId` pasa a ser obligatorio.
- **Fallar cerrado:** un proveedor que lanza una excepción o no contesta en `agentIdentityTimeoutMs` (5 s) deniega la llamada, también con el opt-out. Una respuesta se reutiliza `agentIdentityCacheMs` (5 s; `0` consulta en cada llamada), y un fallo no se recuerda.
- **Auditoría:** `AuditEvent.agentIdentity` (con `assurance`) o `agentIdentityMissing: true`; el `Principal` que ven las políticas lleva `agentIdentity`. Cada agente de una delegación actúa con su propia identidad.
- **Opt-out para pruebas:** `requireAgentIdentity: false` (no apto para entornos regulados; avisa una vez por agente). `@backendkit-labs/agent-testkit` trae `testIdentity()`. `agent-enterprise` y `agent-coding` reenvían `agentIdentity`, `identity` y `requireAgentIdentity`.
- **Plantillas y proyectos generados:** todos llevan `agentIdentity: selfAssertedIdentities()` y `identity: { userId }`; `create-bk-agent` sube de versión por ello. La guía de migración y la página de gobernanza lo explican.
- **Pendiente:** F2 (la firma de cada evento por la identidad) y los ejemplos del repositorio, que esperan a que `agent-core` 0.49.0 esté publicado.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.49.0 | **ruptura**: identidad del agente y a nombre de quién, obligatorias por defecto |
| `agent-coding` | 0.32.12 | reenvía `agentIdentity`, `identity` y `requireAgentIdentity`; depende de core 0.49 |
| `agent-enterprise` | 0.11.8 | ídem; peer `>=0.49.0 <0.50.0` |
| `agent-testkit` | 0.1.21 | `testIdentity()`; peer `>=0.49.0 <0.50.0` |
| `mcp-server` | 0.19.12 | depende de core 0.49 |
| `agent-web` | 0.6.17 | depende de core 0.49 |
| `create-bk-agent` | 0.24.7 | las plantillas llevan identidad y persona |
| `agent-mandates` | 0.1.2 | rango de core ampliado a `<0.50.0` |
| `aval-tools` | 0.1.28 | rango de core ampliado |
| `document-extract` | 0.1.15 | rango de core ampliado |
| `agent-flow-queue` | 0.1.7 | rango de core ampliado |
| `agent-flow-sql` | 0.1.3 | rango de core ampliado |
| `agent-otel` | 0.1.23 | rango de core ampliado |
| `agent-providers` | 0.3.17 | rango de core ampliado |
| `agent-sandbox` | 0.1.23 | rango de core ampliado |

Se publican quince. Orden: `agent-core` primero, `create-bk-agent` al final. Tags: `<paquete>@<versión>` de cada fila.

## v0.49.19 (2026-11-23)

`agent-mandates` ofrece las piezas para escribir el adaptador de cualquier proveedor de identidad. Es aditivo: no cambia lo que ya hacía.

| Paquete | Versión | |
|---|---|---|
| `agent-mandates` | 0.1.1 | SD-JWT (RFC 9901) y las reglas comunes de un adaptador (poderes, consentimiento, garantía), que antes solo vivían en un ejemplo |

Se publica uno. Tag: `agent-mandates@0.1.1`.

## v0.49.18 (2026-11-23)

Cierre de los pendientes de la auditoría que sí se podían cerrar. Ninguno cambia una API: llegan como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-sandbox` | 0.1.22 | imagen Docker fijada por digest; en Windows el contenedor ya no corre como root |
| `document-extract` | 0.1.14 | un ZIP que miente en su cabecera se rechaza por lo que realmente se descomprime |

Se publican dos. Tags: `agent-sandbox@0.1.22`, `document-extract@0.1.14`.

- **`agent-sandbox`, imagen fijada:** la imagen por defecto era `node:22`, una etiqueta que se mueve. Ahora es `DEFAULT_DOCKER_IMAGE` (`node:22` con el digest del índice multiplataforma, que sirve en amd64 y arm64). Una imagen que pases tú se usa tal cual. Para subir el digest: `docker buildx imagetools inspect node:22`.
- **`agent-sandbox`, Windows:** sin uid que prestar, el contenedor corría con el usuario de la imagen (root en la mayoría). Ahora usa `1000:1000`, que no necesita entrada en la base de usuarios de la imagen. Con cualquier usuario fijado, `HOME` es `/tmp` (un uid sin carpeta personal dejaba a npm sin dónde escribir). `user: false` conserva el usuario de la imagen. Probado con un contenedor real: no es root, escribe en el workspace y `npm --version` funciona.
- **`document-extract`, ZIP que miente:** solo se sumaban los tamaños que declara el directorio, y un archivo que declaraba pocos bytes y se expandía a gigabytes llegaba a `mammoth` o `read-excel-file`. Ahora cada parte se descomprime con un tope de salida igual a lo que queda de `maxUncompressedBytes`, antes de abrirla. Cuesta una descompresión extra, acotada por ese límite. Una parte comprimida con un método que no sea almacenado o deflate se rechaza (`UNSUPPORTED_FORMAT`).

No son del SDK y no cambian paquetes: la guía [controles para un agente que actúa por personas](/guides/controls-for-an-agent-without-steward/) (SPEC-0043 F4, **borrador sin revisar contra ninguna norma**) y el arnés de calidad del diseñador (SPEC-0040 F2, sin medición real todavía).

## v0.49.17 (2026-11-23)

Mismo arreglo que `aval-tools` y `document-extract`, ahora para `agent-enterprise`. No cambia ninguna API: llega como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-enterprise` | 0.11.7 | `agent-core` pasa a `peerDependencies` |

Se publica uno. Tag: `agent-enterprise@0.11.7`.

- **`agent-enterprise`, dos copias de `agent-core`:** declaraba `agent-core` como dependencia, así que una app con otra versión de `agent-core` recibía una segunda copia anidada: tipos incompatibles, dos `EventBus` y `instanceof` que da `false` entre copias. Ahora es `peerDependency` (`>=0.48.0 <0.49.0`): la app pone una sola. Si tu app usa un `agent-core` anterior a 0.48, súbelo; las plantillas de `create-bk-agent` ya declaran `agent-core` por su cuenta.

## v0.49.16 (2026-11-22)

Segunda tanda de la cuarta pasada de auditoría. Ninguna cambia una API: llegan como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-flow-queue` | 0.1.6 | dos claves de idempotencia distintas ya no comparten job |
| `agent-otel` | 0.1.22 | números no finitos y mensajes de error largos |
| `mcp-connectors` | 0.2.6 | timeout también al leer el cuerpo; cuerpos de error y de petición acotados |
| `create-bk-agent` | 0.24.6 | `add ...` valida nombres y URL antes de escribirlos en el código generado |
| `agent-web-ui` | 0.1.4 | el cierre tardío de un socket reemplazado ya no deja al hook sin conexión |

Se publican cinco. Tags: `agent-flow-queue@0.1.6`, `agent-otel@0.1.22`, `mcp-connectors@0.2.6`, `create-bk-agent@0.24.6`, `agent-web-ui@0.1.4`.

- **`agent-flow-queue`, colisión de job:** el id del job se sacaba de la clave de idempotencia cambiando `:` por `_`, así que `a_b:c` y `a:b_c` daban el mismo id y un paso podía recibir el resultado de otro. Ahora el escape es reversible (`:` → `%3A`, `%` → `%25`). Los jobs en vuelo al actualizar usan el id antiguo y terminan como hasta ahora.
- **`agent-otel`:** un número `NaN` o `Infinity` en un atributo se enviaba como `null` y el colector rechazaba el lote entero; ahora va como texto. El mensaje de error de un span se corta a 500 caracteres.
- **`mcp-connectors`:** el timeout dejaba de contar al llegar las cabeceras (un servidor que se quedaba parado a mitad del cuerpo colgaba la llamada); ahora cubre la lectura. El cuerpo de una respuesta de error se corta a 500 caracteres en el mensaje que lee el modelo, y el servidor HTTP rechaza peticiones de más de 4 MiB.
- **`create-bk-agent`:** `add specialist`, `add tools` y `add mcp-client` escribían el nombre y la URL tal cual en un nombre de archivo y en el código generado: `../x` salía del directorio y una comilla rompía el literal. Ahora se exige un nombre en kebab-case y una URL http(s), y los literales se escapan.
- **`agent-web-ui`:** al reconectar, el `onclose` del socket anterior llegaba tarde y ponía el estado en desconectado y la referencia en `null`, dejando huérfano al socket nuevo (`sendMessage` ya no enviaba). Ahora solo el socket actual toca el estado, y `disconnect()` lo fija por sí mismo.

Revisados sin hallazgos: `flow-sql`, `pipeline` y `orchestration` de `agent-coding`.

## v0.49.15 (2026-11-22)

Primera tanda de la cuarta pasada de auditoría (`document-extract`, `aval-tools`, `AgentLoader`). Ninguna cambia una API: llegan como parche.

| Paquete | Versión | |
|---|---|---|
| `document-extract` | 0.1.13 | `read_document` no sigue enlaces fuera del directorio; imágenes y páginas gigantes se rechazan antes de reservar memoria |
| `aval-tools` | 0.1.27 | los fallos de red y los 5xx ahora se reintentan y se leen bien; el cuerpo de la respuesta también tiene timeout |
| `agent-coding` | 0.32.11 | `AgentLoader` valida los agentes del disco y `scaffold` rechaza ids con ruta |

Se publican tres. Tags: `document-extract@0.1.13`, `aval-tools@0.1.27`, `agent-coding@0.32.11`.

- **`aval-tools`, nunca reintentaba:** el cliente lanzaba objetos sueltos y `retry` los envolvía, así que `retryIf` no reconocía ninguno: un 5xx o un fallo de red se intentaba una sola vez, y el agente recibía el mensaje `[object Object]`. Ahora lanza `Error` reales marcados como transitorios: se reintentan (3 intentos por defecto) y el mensaje se lee. Además, el timeout dejaba de contar al llegar las cabeceras: un servidor que enviaba cabeceras y se quedaba parado colgaba la herramienta; ahora el timer cubre la lectura del cuerpo. Una credencial vacía cuenta como ausente, y una respuesta inesperada se corta a 300 caracteres antes de llegar al modelo.
- **`document-extract`, enlaces:** la comprobación por defecto de `read_document` era léxica: un enlace dentro del directorio de trabajo que apuntaba fuera pasaba. Ahora se resuelve el destino real. Con OCR, una imagen de un PDF o una página que se dibujaría a un tamaño mayor que `maxPixels` se rechaza antes de construir el PNG o el canvas.
- **`agent-coding`, `AgentLoader`:** un `.json` de agente con forma mala (sin `allowedTools`, `null`, sin `id`) llegaba al registro; ahora se avisa y se omite. `scaffold('../../x')` escribía fuera del directorio de agentes; ahora se rechaza.

Límite conocido, sin cambio: `document-extract` juzga los tamaños que el ZIP declara; un ZIP que miente en su cabecera se descomprime en las librerías (`mammoth`, `read-excel-file`), que no ofrecen un tope real.

## v0.49.14 (2026-11-22)

Los hallazgos menores de la tercera pasada de auditoría. Ninguno cambia una API: llegan como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-sandbox` | 0.1.21 | el `cwd` se juzga por donde aterriza de verdad; la salida multibyte ya no se corrompe |
| `agent-coding` | 0.32.10 | `read_file` con tope; el proveedor de skills de GitHub valida host y tamaño; NAT64/6to4 en la guarda SSRF |

Se publican dos. Tags: `agent-sandbox@0.1.21`, `agent-coding@0.32.10`.

- **`agent-sandbox`, `cwd` léxico:** un enlace dentro del workspace que apuntaba fuera pasaba la comprobación del directorio de trabajo. Ahora se resuelve el destino real, igual que ya hacía `authorizePath`.
- **`agent-sandbox`, salida multibyte:** un carácter UTF-8 partido entre dos trozos de salida se convertía en U+FFFD. Ahora hay un decodificador por flujo.
- **`agent-coding`, `read_file`:** leía el archivo entero; ahora devuelve como mucho 1 MiB y avisa de que cortó.
- **`agent-coding`, skills de GitHub:** el `download_url` que devuelve la API se descargaba sin validar, sin tope y siguiendo redirecciones. Ahora solo se acepta `https://raw.githubusercontent.com`, con tope de 256 KiB y sin redirecciones.
- **`agent-coding`, guarda SSRF:** una dirección NAT64 (`64:ff9b::/96`) o 6to4 (`2002::/16`) que envuelve una IPv4 privada pasaba por pública. Ahora se juzga la IPv4 embebida.

No se tocan, por decisión: fijar la imagen Docker por digest y pasar `--user` en Windows (el contenedor corre con el usuario por defecto de la imagen); queda documentado como límite.

## v0.49.13 (2026-11-22)

Un arreglo de la tercera pasada de auditoría. No cambia ninguna API: llega como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-sandbox` | 0.1.20 | el registro de auditoría ya no traga los errores de escritura |

Se publica uno. Tag: `agent-sandbox@0.1.20`.

- **`agent-sandbox`, auditoría muda:** si `auditLog` no se podía escribir (disco lleno, sin permiso, ruta mala), el error se descartaba y el rastro de auditoría dejaba de existir sin que nadie lo supiera. Ahora se avisa: una advertencia por stderr (una sola por servicio) o, si lo prefieres, la opción nueva `onAuditError(error, line)`. La llamada confinada sigue sin verse afectada.

## v0.49.12 (2026-11-22)

Mismo arreglo que `aval-tools` en la 0.49.11, ahora para `document-extract`. No cambia ninguna API: llega como parche.

| Paquete | Versión | |
|---|---|---|
| `document-extract` | 0.1.12 | `agent-core` pasa a `peerDependencies` |

Se publica uno. Tag: `document-extract@0.1.12`.

- **`document-extract`, dos copias de `agent-core`:** declaraba `agent-core` como dependencia, así que una app con otra versión de `agent-core` recibía una segunda copia anidada, con tipos incompatibles (`ToolDefinition`) y dos copias del framework en ejecución. Ahora es `peerDependency` (`>=0.48.0 <0.49.0`). Si tu app usa un `agent-core` anterior a 0.48, súbelo.

## v0.49.11 (2026-11-22)

Dos arreglos que salieron de llevar un agente real (`aval-scheduler`, ahora en `examples/`) a las versiones actuales. Ninguno cambia una API: llegan como parche.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.10 | `AutonomousAgent.stop()` también cierra los servidores MCP que arrancó |
| `aval-tools` | 0.1.26 | `agent-core` pasa a `peerDependencies`; `@backendkit-labs/retry` pasa a dependencia propia |

Se publican los dos. Tags: `agent-core@0.48.10`, `aval-tools@0.1.26`.

- **`agent-core`, `stop()` dejaba vivos los procesos MCP:** `createAutonomousAgent(...).stop()` paraba el cron, el webhook y los eventos, pero no los servidores de `mcpServers`, que son procesos hijos. Quedaban corriendo mientras el proceso padre siguiera vivo (un test que no terminaba, un agente embebido en otro programa). Ahora `stop()` los desconecta; un `start()` o una corrida posterior los vuelve a conectar.
- **`aval-tools`, dos copias de `agent-core`:** declaraba `agent-core` como dependencia, así que una app con otra versión de `agent-core` recibía una segunda copia anidada. Los tipos de las dos copias (`ToolDefinition`, `ExecutionContext`) no son compatibles, y `tools: [...createAvalTools()]` no compilaba; en ejecución había dos copias del framework. Ahora es `peerDependency` (`>=0.48.0 <0.49.0`): la app pone una sola. Si tu app usa un `agent-core` anterior a 0.48, súbelo. `@backendkit-labs/retry` se usaba sin declararse (llegaba por `agent-core`) y ahora es dependencia propia.

## v0.49.10 (2026-11-22)

Tercera pasada de la auditoría: el sandbox y el agente de código. Cambia un comportamiento por defecto (el entorno de los comandos), por eso llega como parche: quien tiene `^0.32.0` debe recibirlo. `agent-coding` sube el rango de `agent-sandbox` a `^0.1.19`.

| Paquete | Versión | |
|---|---|---|
| `agent-sandbox` | 0.1.19 | el entorno sin credenciales también descarta cookies, valores privados, DSN, `SSH_AUTH_SOCK` y cualquier valor que sea una cadena de conexión con contraseña |
| `agent-coding` | 0.32.9 | `run_command` en el host arranca con el entorno filtrado, protección del repo del framework solo en ese repo, registro remoto con `sha256` |

Se publican los dos, `agent-sandbox` primero. Tags: `agent-sandbox@0.1.19`, `agent-coding@0.32.9`.

- **`agent-coding`, qué puede leer un comando:** sin `sandbox`, `run_command` pasaba todo el entorno y el modelo lee lo que un comando imprime (`printenv` está permitido). Ahora las variables que parecen credenciales no se pasan. `BK_RUN_COMMAND_ENV_ALLOW=GH_TOKEN,NPM_TOKEN` deja pasar las que elijas; `BK_RUN_COMMAND_ENV=inherit` devuelve el comportamiento anterior. La lista de binarios permitidos no es aislamiento: para eso, el `sandbox`.
- **`agent-sandbox`:** la política por defecto descarta además cookies, valores privados y DSN, `SSH_AUTH_SOCK` (se deja pasar con `env.allow`) y cualquier variable cuyo **valor** sea `esquema://usuario:contraseña@host`, se llame como se llame.
- **`agent-coding`, protección del repo del framework:** la comprobación de rutas protegidas solo se aplica cuando el proyecto es el repo del framework; antes bloqueaba carpetas con ese nombre en cualquier proyecto.
- **`agent-coding`, registro remoto de agentes:** el archivo descargado debe coincidir con el `sha256` del índice (si no, se rechaza y no se escribe nada), máximo 256 KB, un nombre de paquete no sale del directorio de caché, y una copia en caché editada se vuelve a descargar. Sin hashes en el índice funciona con un aviso; `requireIntegrity: true` lo rechaza. Un perfil que pide `run_command`, `write_file` o `edit_file` se avisa al instalarlo.

## v0.49.9 (2026-11-22)

Segunda pasada de la auditoría del framework: el servidor web, el RAG de empresa y el cliente MCP. Casi todo son arreglos de seguridad que **cambian un comportamiento por defecto** (se dice en cada punto), por eso llegan como parche: quien tiene `^0.6.0` o `^0.11.0` debe recibirlos. `^0.48.0` cubre `agent-core` 0.48.9, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.9 | `ctx.idempotencyKey`, nombres de tools y de servidores MCP, descripciones acotadas |
| `agent-web` | 0.6.16 | guarda de `Origin` y `Host`, límites por sesión, webhooks firmados, opciones de `JwtAuth` |
| `agent-enterprise` | 0.11.6 | búsqueda global sin RR. HH. ni Finanzas, escritura por departamento, procedencia, registro encadenado del gate |

Se publican los tres. Tags: `agent-core@0.48.9`, `agent-web@0.6.16`, `agent-enterprise@0.11.6`.

- **`agent-web`, un sitio web podía manejar el agente y leer las sesiones:** sin `auth`, el servidor en loopback aceptaba cualquier `Origin`. El handshake de un WebSocket no está sujeto a CORS: una página abierta en el navegador podía conectarse a `ws://127.0.0.1:3000/chat`, mandar `input` y suscribirse a `/monitor` para leer todas las sesiones (se reprodujo). Ahora una petición sin `auth` tiene que venir de loopback (su `Host` y su `Origin`) o de un origen que `cors` liste; si no, `403`. Con `auth`, el token es lo que deja pasar, y una lista explícita en `cors` se exige también en el upgrade. Las rutas de webhook quedan fuera: las autentica su firma.
- **`agent-web`, webhooks:** `addWebhook` **lanza** si no hay `secret` ni `allowUnsigned: true` (antes cualquiera que alcanzara la ruta hacía correr un prompt). Y el hook `auth` (JWT) ya no se aplica a las rutas de webhook: un emisor como GitHub no manda un JWT.
- **`agent-web`, límites por sesión:** `maxPendingInputs` (4 por defecto: turnos en cola o en curso; el siguiente recibe un error) y `maxMessageBytes` (1 MiB, el WebSocket cierra con un mensaje mayor). Una sesión con un turno en curso ya no se expulsa por inactiva.
- **`agent-web`, errores:** el cliente recibe "The agent could not answer. Try again." y el detalle va al log del servidor. `exposeErrors: true` devuelve el mensaje como antes.
- **`agent-web`, `JwtAuth`:** `requireExpiry` y `requireSubject` (opt-in) rechazan un token que no caduca o sin usuario; una clave simétrica solo verifica HMAC y una pública solo los asimétricos; el esquema `Bearer` no distingue mayúsculas.
- **`agent-enterprise`, el agente `general` ya no lee RR. HH. ni Finanzas por defecto:** buscaba en todo el vault con el proveedor por defecto (posiblemente remoto), así que lo recuperado de esas carpetas salía de la red aunque los agentes de RR. HH. y Finanzas usaran un proveedor local. Ahora `globalExcludeFolders` vale `['rrhh', 'finanzas']`; con `[]` se recupera el comportamiento anterior.
- **`agent-enterprise`, escritura por departamento:** `write_knowledge` escribe en la carpeta del departamento del agente que llama (los prompts ya lo decían, el código dejaba todo en `agentes/`) y la nota dice quién la escribió. Una nota que escribió un agente aparece en la búsqueda como "escrita por un agente, no verificada". Una nota ya no se sobrescribe (el mismo título el mismo día recibe un número), un título solo de símbolos tiene nombre propio, hay un límite de 200 000 caracteres y un `.lock` huérfano deja de bloquear.
- **`agent-enterprise`, `ComplianceGate`:** `audit` (y `gateAudit` en `FlowRunner`) escribe cada evento del gate en un `AuditSink`; con un `HashChainAuditSink`, el registro es una cadena verificable, no solo una nota editable en el vault. Un sink que falla detiene la evaluación. Un índice RAG sin `indexPath` ya no se comparte entre proveedores con carpetas distintas.
- **`agent-core`, `ctx.idempotencyKey`** (ver #283): la misma llamada lógica lleva la misma clave, para que una tool que escribe no aplique dos veces lo que el modelo repite tras un timeout.
- **`agent-core`, cliente MCP:** una tool cuyo nombre no es válido para los proveedores (espacios, más de 64 caracteres en total) se deja fuera y se avisa, en vez de romper las llamadas de todas; dos servidores cuyo nombre da el mismo prefijo se rechazan al construir; la descripción de una tool se acota a 2000 caracteres; un `restartAgent` simultáneo se serializa; y el fallback a SSE ya no se dispara por cualquier número de tres cifras en el mensaje.

## v0.49.8 (2026-11-22)

Apoderamiento de agentes (SPEC-0043, F1 y F2): un agente puede actuar solo, dentro de los límites de un poder firmado por quien tiene autoridad. Es aditivo y por defecto no cambia nada: `^0.48.0` cubre `agent-core` 0.48.8, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.8 | `Mandate`, `MandateVerifier`, `mandatePolicy` y el campo `mandate` de la auditoría |
| `agent-mandates` | 0.1.0 | **nuevo, sin publicar todavía**: verificador por defecto de credenciales firmadas |

Se publica `agent-core`. `agent-mandates` es un paquete nuevo y **no se publica sin consulta**. Tag: `agent-core@0.48.8`.

- **`agent-core`, apoderamientos:** un `Mandate` dice a nombre de quién actúa el agente, qué puede hacer, sobre qué y hasta qué importe, sin depender del formato de la credencial. Un `MandateVerifier` (el tuyo, un paquete, Steward) lo obtiene y `mandatePolicy` decide con los hechos de la llamada: dentro del poder, permite sin preguntar a nadie; sin un poder válido, deniega; fuera de él, pide aprobación (o deniega). Falla cerrado en todo: sin verificador, uno que lanza, caducado, de otra persona u otro agente, o con un límite que la política no puede medir. El evento de auditoría guarda el mandato (id, emisor, persona que apodera, vigencia y el hash de la credencial; nunca la credencial). Nuevos exports: `mandatePolicy`, `mandateCovers`, `auditMandate` y los tipos `Mandate`, `MandateRequest`, `MandateVerification`, `MandateVerifier`, `MandatePolicyOptions` y `AuditMandate`.
- **`agent-mandates` 0.1.0 (nuevo):** `jwtMandateVerifier` lee una credencial con la forma de un SD-JWT VC (JWT firmado con `EdDSA` o `ES256`), de un emisor que el operador confía, con su expiración, y un gancho de revocación (si falla, cuenta como revocado). Rechaza `none`, los algoritmos simétricos y una clave de otro tipo; una credencial con divulgación selectiva se rechaza, no se lee a medias. `issueMandate` emite un mandato en ese perfil (pruebas, demos, quien se apodera a sí mismo). El formato de un proveedor concreto (el sistema compatible con eIDAS 2, una cartera eIDAS 2) será un adaptador al mismo `Mandate`.

## v0.49.7 (2026-11-22)

Cambio interno de `agent-core`, sin cambio de comportamiento: la parte de gobierno del motor se mueve a su propio archivo. `^0.48.0` cubre 0.48.7, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.7 | `GovernanceGate` sale de `AgentEngine` |

Solo se publica `agent-core`. Tag: `agent-core@0.48.7`.

- **`agent-core`, la compuerta de gobierno tiene su propio archivo:** lo que decide si una llamada a una herramienta se permite (políticas, aprobador en vivo o almacén, rol y cuatro ojos, caducidad, credenciales por llamada) vivía mezclado en `AgentEngine`, de unas 2200 líneas. Ahora está en `engine/GovernanceGate.ts` y el motor la llama. El código es el mismo y el orden de las comprobaciones no cambia; no hay API pública nueva (`GovernanceGate` no se exporta) ni opciones nuevas. Se añaden 12 pruebas que ejercitan la compuerta sola, sin motor ni proveedor.

## v0.49.6 (2026-11-22)

Arreglos de la auditoría del framework (#276). Casi todo es aditivo y por defecto no cambia nada, así que `^0.48.0` cubre `agent-core` 0.48.6 y no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.6 | aprobación con vista completa, `approverTimeoutMs`, args que no son objeto, webhook, almacén de aprobaciones |
| `agent-providers` | 0.3.16 | respuestas cortadas por el límite de salida, `streamIdleTimeoutMs` |
| `mcp-server` | 0.19.11 | cuerpo limitado, sin errores internos al cliente |
| `agent-coding` | 0.32.8 | `/plugin add pkg@versión`, sin código muerto |

Se publican los cuatro. Tags: `agent-core@0.48.6`, `agent-providers@0.3.16`, `mcp-server@0.19.11`, `agent-coding@0.32.8`.

- **`agent-core`, la aprobación se pide sobre lo que de verdad se ejecuta:** `approverFromCallback` y el evento `tool_approval_request` mostraban los argumentos cortados a 200 caracteres, y lo que quedaba fuera no se veía. Ahora son 4000 y, si aun así se corta, dice cuánto no se muestra. Un `Approver` propio ya recibía la solicitud completa.
- **`agent-core`, `approverTimeoutMs` (opt-in):** las preguntas al aprobador van de una en una, así que uno que no responde frenaba todas las demás. Pasado el tiempo la llamada se deniega y se audita. Sin la opción no hay límite, como antes.
- **`agent-core`, argumentos que no son un objeto JSON:** un array, `null` o un número llegaban a las políticas como `{}`. Ahora se deniegan antes.
- **`agent-core`, políticas sin aprobador en común:** si las políticas aceptan tipos de aprobador distintos y no queda ninguno, la llamada se deniega (antes se preguntaba a una persona y se rechazaba siempre), igual que con los roles.
- **`agent-core`, un timeout de una tool que escribe** avisa al modelo de que puede seguir corriendo, para que no la repita a ciegas.
- **`agent-core`, almacén de aprobaciones:** un JSON corrupto da un error claro (antes, "no existe"), `list` lo salta y se borran los `.tmp` de más de una hora.
- **`agent-core`, `WebhookServer`:** un handler `async` que rechaza ya no tumba el proceso, la ruta acepta query string, `host` es opcional y `stop()` cierra las conexiones abiertas.
- **`agent-core`, auditoría:** el bundle se lee una vez al exportar, un manifest que no describe el log da un aviso, `AuditLogger` avisa una vez si no puede escribir y `HashChainAuditSink` acepta `fsync: false` (por defecto sigue vaciando a disco en cada entrada).
- **`agent-providers`, respuestas cortadas:** una respuesta que llega al límite de salida (`max_tokens`) se marcaba como completa. Ahora el texto lleva una nota y un tool call cortado es un error, no una llamada con la mitad de sus argumentos. Nueva opción `streamIdleTimeoutMs` (120 s por defecto, `0` la apaga): un stream que deja de enviar se corta y, si todavía no salió nada, se reintenta. Solo en los proveedores OpenAI-compatibles y Anthropic.
- **`mcp-server`:** el cuerpo de una petición se limita a 1 MiB (413), los errores internos ya no llegan al cliente y el esquema `Bearer` no distingue mayúsculas.
- **`agent-coding`:** `/plugin add pkg@1.2.3` buscaba el paquete con la versión en el nombre y siempre fallaba; los paquetes escritos a mano se instalan ahora sin scripts de instalación. Se borran dos archivos sin uso.

## v0.49.5 (2026-11-21)

Dos cambios aditivos de `agent-core` que cierran la SPEC-0042: las aprobaciones guardadas caducan y las credenciales se conceden por llamada. Por defecto no cambia nada, y `^0.48.0` cubre 0.48.5, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.5 | caducidad de aprobaciones y credential broker (SPEC-0042 F3 y F4) |

Solo se publica `agent-core`. Tag: `agent-core@0.48.5`.

- **`agent-core`, las aprobaciones guardadas caducan (SPEC-0042 F3):** una aprobación guardada se ejecutaba tan tarde como fuera. Nueva opción `approvalTtlSeconds` en `createBaseEngine` y `ttlSeconds` en el `ask` de una política (gana el más corto, también al combinar políticas). La solicitud guarda `expiresAt` y `runApproved` rechaza una aprobación caducada, esté pendiente o ya aprobada; el rechazo se audita (`deny`, con la hora en que caducó) y la solicitud queda gastada: hace falta una nueva. Falla cerrado: un `ttlSeconds` que no es un número positivo caduca al instante, un `expiresAt` ilegible cuenta como caducado y un `approvalTtlSeconds` inválido lanza al crear el motor. El aprobador inmediato no se ve afectado. **Por defecto nada caduca.**
- **`agent-core`, credenciales concedidas por llamada (SPEC-0042 F4):** las `secrets` de un agente llegan a todas sus tools en todas las llamadas. Ahora una tool declara `credentials: ['treasury']` y el motor, con un `credentialBroker`, concede cada una para **una** llamada, **después** de la política, las guardas y la aprobación, y la entrega en `ctx.credentials`. El broker (`lease(request)`) sabe qué tool es, para quién, con qué `argsHash` (el mismo del evento de auditoría) y con qué aprobación; devuelve `{ value, id, expiresAt?, release? }`. Se libera siempre al terminar (éxito, error o timeout) y el evento de auditoría guarda `credentials: [{ name, id, expiresAt, released }]`, nunca el valor; un `release` que falla queda como `released: false`. Falla cerrado: sin broker, con un broker que lanza o con una concesión sin valor, sin id, caducada o con un `expiresAt` ilegible, la tool no se ejecuta y se audita; con varias credenciales es todo o nada. Una simulación (`dry_run`) no recibe credenciales ni llama al broker. Las `secrets` del agente no cambian. **Límite:** el valor llega a la tool dentro del proceso, así que esto no evita que una tool con un fallo lo filtre mientras es válido; protege con alcance, vida corta, revocación y auditoría. El SDK define el contrato, no una implementación: un proxy fuera del proceso es de plataforma. Nuevos exports: los tipos `CredentialBroker`, `CredentialLease`, `CredentialRequest` y `AuditCredential`; `defineTool` acepta `credentials`.

## v0.49.4 (2026-11-21)

Cambio aditivo de `agent-core`: anclas del `head` de la auditoría fuera del alcance del operador. Un tipo publicado hace poco se ensancha (`anchored`, de `false` a `boolean`). `^0.48.0` cubre 0.48.4, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.4 | anclas de la auditoría y verificación con anclas propias (SPEC-0042 F2) |

Solo se publica `agent-core`. Tag: `agent-core@0.48.4`.

- **`agent-core`, anclas de la auditoría (SPEC-0042 F2):** una firma sola no impide que quien tiene la clave privada reescriba el log, los puntos de control y las claves. Un ancla guarda `(seq, head)` fuera de su alcance, y desde ahí cambiar cualquier entrada hasta ese punto se detecta aunque todo lo demás esté reescrito. Nuevos: la interfaz `TimestampAnchor` (`anchor` y `verify`), `anchorAuditLog({ log, anchors, anchor })` (idempotente; rechaza un log vacío o roto y un ancla que responda por otro punto), `fileAnchor(ruta)` (añade `{ seq, head, at }` a un archivo testigo) y `verifyAuditBundleAnchored(dir, { trustedKeys, anchors })`, que comprueba cada registro con el ancla **que pasa quien verifica** (por ejemplo su copia del archivo testigo) y nunca con la ruta que dice el registro. `exportAuditBundle` acepta `anchors` y copia `anchors.ndjson`. Un registro que no verifica hace fallar el paquete; los de un tipo que no se pasó se listan sin verificar. También se detecta cortar la cola que ningún punto de control firmó, si un ancla la cubre. **Lo que cuenta es dónde vive el ancla:** un archivo que el operador puede editar no ancla nada. RFC 3161, un commit en otro repositorio o un servicio propio serían otras implementaciones de la misma interfaz y no están construidas. Nuevos exports: `anchorAuditLog`, `fileAnchor`, `readAnchors`, `verifyAuditBundleAnchored` y los tipos `AnchorRecord`, `AnchorVerification`, `TimestampAnchor`.
- **Ensanche de un tipo:** `BundleVerification` (publicado en 0.48.3) tenía `anchored: false`; ahora es `anchored: boolean` y tiene `anchoredUpTo` y `anchorRecords`. `verifyAuditBundle` sigue devolviendo `anchored: false` (la comprobación sin conexión no verifica anclas); solo `verifyAuditBundleAnchored` puede devolver `true`. Quien solo lee el campo no se rompe.

## v0.49.3 (2026-11-21)

Cambio aditivo de `agent-core`: evidencia de auditoría que un tercero puede comprobar sin el secreto del operador. El formato del log no cambia, y `^0.48.0` cubre 0.48.3, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.3 | puntos de control firmados y paquete de auditoría (SPEC-0042 F0/F1) |

Solo se publica `agent-core`. Tag: `agent-core@0.48.3`.

- **`agent-core`, auditoría verificable por terceros (SPEC-0042 F0/F1):** `HashChainAuditSink` acepta `checkpoints: { signer, path, every? }` y firma el `head` con Ed25519 cada `every` entradas y con `checkpoint()` a demanda, en un archivo aparte (el formato del log no cambia). `ed25519Signer(clave, kid)` crea el firmante. `exportAuditBundle` escribe una carpeta con el log, los puntos de control, las claves públicas y un manifiesto, y `verifyAuditBundle(dir, { trustedKeys })` la comprueba **sin conexión y sin el secreto del operador**: la cadena, cada firma, que cada punto de control nombre una entrada real con ese hash y que vayan en orden. Las claves que cuentan son las que pasa quien verifica; sin ellas usa las del paquete y el resultado dice `keySource: 'bundle'`, porque un falsificador incluiría la suya. Rotación de claves por `kid`. **Límites declarados:** las entradas posteriores al último punto de control no están cubiertas (`unsignedTail`) y cortarlas no se detecta, y quien tiene la clave privada puede reescribir el log y volver a firmarlo, porque falta un ancla fuera de su alcance (`anchored: false`, SPEC-0042 F2). Hoy un paquete es *tamper-evident*, no una prueba legal. Nuevos exports: `ed25519Signer`, `signCheckpoint`, `appendCheckpoint`, `readCheckpoints`, `checkpointMessage`, `exportAuditBundle`, `verifyAuditBundle`, `BUNDLE_FORMAT` y los tipos `AuditCheckpoint`, `CheckpointSigner`, `HashChainCheckpointOptions`, `BundleManifest`, `BundleVerification`.

## v0.49.2 (2026-11-21)

Cambio aditivo de `agent-core`: cuatro ojos opcionales en las aprobaciones. Por defecto no cambia nada, y `^0.48.0` cubre 0.48.2, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.2 | `forbidSelfApproval` (SPEC-0041 F2) |

Solo se publica `agent-core`. Tag: `agent-core@0.48.2`.

- **`agent-core`, quien pidió no aprueba lo que pidió (SPEC-0041 F2):** nueva opción `forbidSelfApproval` en `createBaseEngine`, apagada por defecto. Con ella, el usuario por quien actúa el agente (`identity.userId`) no puede aprobar su propia solicitud, sea cual sea el tipo de aprobador, ni tampoco una persona de la cadena de delegación. En una aprobación guardada, quién pidió es lo que registró la solicitud (`requestedBy` en `ToolCall.approved`, que pone `runApproved`), no la identidad de quien la ejecuta después: un worker reiniciado y sin identidad propia también la rechaza. Sin `identity.userId` no hay con quién comparar y la regla no hace nada. Se suma a `approverRoles` (0.48.1): quien pidió y tiene el rol sigue sin poder aprobar. `approvalProblem` acepta `forbidSelfApproval` en su segundo argumento (opcional).
- **Documentación:** la página de gobernanza decía que nadie aprueba su propia solicitud, pero eso solo valía para agentes y servicios: una persona que pidió la acción podía aprobarla. Está corregido. La guía "Govern a payment tool" tiene un paso 6 con roles, directorio y cuatro ojos.

## v0.49.1 (2026-11-21)

Cambio aditivo de `agent-core`: un `ask` puede exigir un rol y el motor lo comprueba. Sin `approverRoles` nada cambia, y `^0.48.0` cubre 0.48.1, así que no hay barrido de rangos.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.1 | `approverRoles` y `approverDirectory` (SPEC-0041 F1) |

Solo se publica `agent-core`. Tag: `agent-core@0.48.1`.

- **`agent-core`, quién puede aprobar se comprueba (SPEC-0041 F1):** hasta ahora el `ask` de una política solo restringía el **tipo** de aprobador (`accepts`); el texto libre `approver` es una pista que el motor no lee. Ahora un `ask` puede llevar `approverRoles: ['finance']`: el aprobador necesita al menos uno de esos roles. El motor los pregunta a un `approverDirectory` de la aplicación (`describe(by)` devuelve `{ roles, tenantId? }`) y **nunca** usa lo que diga quien llama. Falla cerrado: sin directorio, con un id desconocido, con un directorio que lanza, con un aprobador de otro tenant o sin ningún rol coincidente, la aprobación se rechaza y la llamada no se ejecuta. Vale para el aprobador inmediato y para `runApproved` (con la política y el directorio de ese momento). El evento de auditoría guarda `approval.authority` (roles reconocidos y el rol que valió). Varias políticas se combinan por intersección; si no queda ningún rol, se deniega. **El framework no autentica:** `by.id` debe llegar ya verificado por la aplicación. Nuevos exports: `ApproverDirectory`, `ApproverProfile`, `ApproverAuthority`, `approverAuthority`.

## v0.49.0 (2026-11-18)

Un fallo de una tool de un servidor MCP deja de volver como éxito (cambio de comportamiento de `agent-core`). En 0.x, `^0.47` no cubre 0.48, así que se barrieron los rangos de `agent-core` (`^0.48.0`) y los peers anchos pasan a `<0.49.0`; `agent-flow-sql` también, porque su peer acababa en `<0.48.0`. `codemod`, `agent-protocol`, `mcp-connectors` y `agent-web-ui` no cambian.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.48.0 | **cambia el comportamiento:** una tool MCP con `isError` lanza `MCP_TOOL_ERROR` |
| `agent-coding` 0.32.7, `agent-enterprise` 0.11.5, `mcp-server` 0.19.10, `agent-web` 0.6.15, `agent-providers` 0.3.15, `agent-sandbox` 0.1.18, `agent-testkit` 0.1.20, `agent-otel` 0.1.21, `agent-flow-queue` 0.1.5, `agent-flow-sql` 0.1.2, `document-extract` 0.1.11, `aval-tools` 0.1.25, `create-bk-agent` 0.24.5 | patch | solo el rango de `agent-core` (y los templates) |

Guía: [Migrate between versions](https://backendkit-agent-framework.vercel.app/guides/migrate-between-versions/).

- **`agent-core`, un fallo de una tool MCP ya no vuelve como éxito (con cambio de comportamiento):** `MCPClientManager` no miraba `isError` en la respuesta de un servidor MCP. Cuando el servidor decía que la llamada había fallado (argumentos inválidos, denegada, error), el `execute` de la tool devolvía el texto del error **como un resultado normal**: la auditoría y el aprendizaje la contaban como éxito, y un script no podía distinguirla. Ahora, con `isError: true`, el `execute` lanza un `ToolError` con código `MCP_TOOL_ERROR` (constante exportada) y el texto del servidor. Dentro de un engine, la llamada pasa a ser un fallo con su código y el modelo sigue leyendo el texto del servidor. **Cambia el comportamiento** de quien tenga tools de servidores MCP que fallan: ahora cuentan como fallos en la auditoría y el aprendizaje, y un `execute` llamado directamente lanza. Descubierto al escribir el ejemplo determinista de la web: un script puede llamar a una tool remota con `MCPClientManager.getTools()` y `createToolContext`.

## v0.48.2 (2026-11-18)

Patch aditivo: un id por corrida (SPEC-0039 F1), el registro de tools del motor y `extraTools` para el agente de código. `^0.47.0`, `^0.32.0` y `^0.1.0` cubren estas versiones, así que no hay barrido de rangos y solo suben tres paquetes.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.47.2 | `runId` en el resultado, la auditoría y los spans; `getTools()` |
| `agent-coding` | 0.32.6 | `extraTools` |
| `agent-testkit` | 0.1.19 | `evalSuite` da a cada corrida un `runId` determinista, para que el informe siga siendo repetible con `agent-core` 0.47.2 |

- **`agent-core`, `engine.getTools()`; `agent-coding`, `extraTools`:** `getTools()` devuelve el registro de tools del motor, para inspeccionar, envolver o sustituir una definición sin bifurcar el framework (`unregister(name)` y `register(definición)`; la siguiente corrida usa la nueva). `createCodingEngine({ extraTools })` añade tools propias a las del agente de código, detrás de ellas; una con el nombre de una existente **no** la sustituye (para eso, `getTools()`). Venían del PR #19, reaplicado sobre `master`, con pruebas. Para decidir qué puede ejecutarse, la política y la aprobación siguen siendo el camino: `getTools()` cambia la definición, no el gobierno.
- **`agent-core`, un id por corrida (SPEC-0039 F1):** `engine.run(input, { runId? })` da a cada corrida un `runId` (el que pases, por ejemplo el de un flujo, o un UUID). Está en `RunResult.runId`, en cada `AuditEvent.runId` (opcional; entra en la cadena de hashes) y como etiqueta `run_id` en los spans, y el evento `ready` lo lleva. De un evento de auditoría se llega a su corrida y a su traza, y al revés. Un delegado comparte el id del turno. Aditivo: todo es opcional. **`agent-testkit`:** `evalSuite` pasa a cada corrida un `runId` determinista (`suite/caso/repetición`), para que el mismo informe siga saliendo igual y se puedan encontrar los eventos de auditoría de una corrida de la suite.

## v0.48.1 (2026-11-18)

Patch aditivo: el arnés de evaluación (SPEC-0021) y la opción que le da los argumentos de las llamadas. `^0.47.0` cubre 0.47.1 y `agent-testkit` no tiene dependientes con un rango que se rompa, así que no hay barrido de rangos y solo suben estos dos paquetes. Los graders que leen argumentos necesitan `agent-core` 0.47.1 o más (con una versión anterior `recordArgs` no existe y esos graders fallan diciéndolo).

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.47.1 | `recordArgs` |
| `agent-testkit` | 0.1.18 | `evalSuite`, `compare`, graders, `writeReport` y `readReport` |

- **`agent-core`, `recordArgs`:** `createBaseEngine({ recordArgs: true })` pone los argumentos de cada llamada a una tool en `RunResult.toolCalls[].args` (SPEC-0021 F0). Van solo al resultado: el evento `tool_result` no los lleva, así que ningún transporte los recibe. Apagado por defecto: pueden llevar datos sensibles y la auditoría solo guarda su hash. Aditivo.
- **`agent-testkit`, arnés de evaluación (SPEC-0021 F1 a F4):** `evalSuite`, `compare`, `formatReport`, `formatComparison`, `writeReport` / `readReport` (un informe guardado en un archivo `0o600`, para comparar entre ejecuciones) y graders (`toolCalled`, `toolNotCalled`, `noToolErrors`, `errorCode`, `textMatches`, `withinBudget`, `maxToolCalls`, `grader`). Casos como datos, repeticiones con semilla, informe JSON repetible (`schema: 1`) y comparación de dos configuraciones; con un proveedor guionizado o una grabación corre en CI sin modelo ni coste. La suite se detiene si una corrida supera el presupuesto del engine y lo dice en el informe. Sin probar con un modelo real ni con el banco `trading-bot` (F5). Ver la guía [Test an agent](https://backendkit-agent-framework.vercel.app/guides/test-an-agent/).

## v0.48.0 (2026-11-18)

Se elimina `FileRunJournal` (ruptura de `agent-core`, SPEC-0024 F4). En 0.x, `^0.46` no cubre 0.47, así que se barrieron los rangos de `agent-core` (`^0.47.0`) y los peers anchos pasan a `<0.48.0`. `agent-flow-sql` no sube: su peer (`>=0.46.0 <0.48.0`) ya cubre 0.47. `codemod`, `agent-flow-sql`, `agent-protocol`, `mcp-connectors` y `agent-web-ui` no cambian.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.47.0 | **rompe:** sin `FileRunJournal` (usa `NdjsonRunJournal`) |
| `agent-coding` 0.32.5, `agent-enterprise` 0.11.4, `mcp-server` 0.19.9, `agent-web` 0.6.14, `agent-providers` 0.3.14, `agent-sandbox` 0.1.17, `agent-testkit` 0.1.17, `agent-otel` 0.1.20, `agent-flow-queue` 0.1.4, `document-extract` 0.1.10, `aval-tools` 0.1.24, `create-bk-agent` 0.24.4 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, con ruptura: `FileRunJournal` se elimina** (SPEC-0024 F4). Era el primer journal de archivo (un archivo por evento) y `NdjsonRunJournal` (0.45.0) lo mejora en todo para un host: unas 3 veces más rápido al escribir y 58 veces al leer, con integridad por cadena y relevo inmediato de un dueño muerto. Se quitó en vez de deprecarlo porque el framework está en desarrollo. **Migración:** cambia `new FileRunJournal(dir)` por `new NdjsonRunJournal(dir)`. Las corridas que un `FileRunJournal` dejó en disco **no las lee** `NdjsonRunJournal` (otro formato): una corrida a medias no se reanuda, y una terminada hay que leerla antes de actualizar si interesa. El claim de `NdjsonRunJournal` se libera al morir su dueño (comprobación del pid) y no por TTL, así que **dos contenedores que comparten un volumen no se ven los pids**: ahí usa `RedisRunJournal` o `PostgresRunJournal`. Ver [Migrate between versions](https://backendkit-agent-framework.vercel.app/guides/migrate-between-versions/).

## v0.47.1 (2026-11-18)

Patch: un buscador propio y un modo nuevo para `tool_search`, y la documentación de `agent-flow-sql`. Es aditivo: `^0.46.0` cubre 0.46.1, así que no hay barrido de rangos y solo suben estos dos paquetes.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.46.1 | `toolSearch.search` y `toolSearch.mode` (SPEC-0030 F5 y §11) |
| `agent-flow-sql` | 0.1.1 | solo el README: probado con Postgres 14 a 18; pgbouncer en modo statement no funciona (rechaza las transacciones) |

- **`agent-core`, un buscador propio para `tool_search`:** `createBaseEngine({ toolSearch: { search, maxResults } })`. `search(query, candidates)` (síncrono o asíncrono) recibe solo las tools diferidas que el agente puede llamar y que ni la política ni la sandbox deniegan; lo que devuelva y no sea candidata se descarta, así que no puede saltarse el gobierno. Sin probar con embeddings reales.
- **`agent-core`, `toolSearch.mode: 'message'`:** la lista de tools del modelo no cambia; la respuesta de `tool_search` trae nombre, descripción y parámetros de lo encontrado y el modelo llama a la tool por su nombre. Evita cortar la caché del proveedor en cada búsqueda. Con DeepSeek (40 tools, 9 corridas por variante) costó lo mismo que listar las 40 tools, con un 64 % menos de tokens de entrada y sin fallos; el modo por defecto (`'list'`) costó un 10 % más. No ahorra dinero con pocas tools; sirve con listas grandes o cuando el límite es el contexto. Sin probar con Anthropic ni OpenAI: si un proveedor rechaza la llamada a una tool que no está en su lista, no sirve con él. Ver SPEC-0030 §10 y §11.

## v0.47.0 (2026-11-18)

`tool_search` para tools diferidas, un arreglo real de la renovación del claim, el adaptador del AI SDK y dos paquetes nuevos (`agent-flow-sql`, `codemod`). En 0.x, `^0.45` no cubre 0.46, así que se barrieron los rangos de `agent-core` (`^0.46.0`) y los peers anchos pasan a `<0.47.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.46.0 | `tool_search` y `defer` / `deferTools` (#233); arreglo de la renovación del claim en `runFlow` (#234); `agent-core/testing` con `journalConformance` |
| `agent-providers` | 0.3.13 | `AiSdkProvider` y `fromAiSdk` (#232); el peer de `agent-core` sube a `<0.47.0` |
| `agent-flow-sql` | 0.1.0 | **nuevo:** `RunJournal` sobre SQLite y Postgres; peer `agent-core >=0.46.0 <0.48.0` |
| `@backendkit-labs/codemod` | 0.1.0 | **nuevo:** migraciones automáticas de las rupturas ([SPEC-0037](docs/specs/SPEC-0037-codemods-y-guias-de-migracion.md)) |
| `agent-coding` 0.32.4, `agent-enterprise` 0.11.3, `mcp-server` 0.19.8, `agent-web` 0.6.13, `agent-sandbox` 0.1.16, `agent-testkit` 0.1.16, `agent-otel` 0.1.19, `agent-flow-queue` 0.1.3, `document-extract` 0.1.9, `aval-tools` 0.1.23, `create-bk-agent` 0.24.3 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, `tool_search` (SPEC-0030):** una tool con `defer: true` (o que case con `deferTools` del agente, solo comodines) no se manda al modelo con su esquema; el modelo la descubre con `tool_search` y desde ese momento forma parte de la lista, siempre al final de la lista (aun así cada búsqueda cambia la lista y la caché del proveedor se corta ahí; ver SPEC-0030 §10). El gobierno no se salta: lo que la sandbox o la política deniegan sigue oculto, y encontrar una tool nunca la autoriza.
- **`agent-core`, arreglo de `runFlow` (#234):** una renovación del claim aún en vuelo cuando la corrida terminaba podía llegar después de liberar el claim y volver a tomarlo, dejando la corrida retenida hasta que vencía el TTL; ahora `runFlow` espera la renovación (con tope) antes de liberar. Era la causa de las pruebas intermitentes en Windows.
- **`agent-core/testing`:** `journalConformance`, la batería que cualquier `RunJournal` debe pasar (la usa `agent-flow-sql`).
- **`agent-providers`, `AiSdkProvider` / `fromAiSdk` (SPEC-0029):** cualquier modelo del AI SDK (interfaces v2, v3 y v4) como proveedor del framework. Probado en vivo con DeepSeek; sin probar con Anthropic ni Gemini, y los bloques de razonamiento opacos (`raw`) no se transportan.
- **`agent-flow-sql`, nuevo:** `RunJournal` sobre SQLite y Postgres: las corridas sobreviven al proceso y cualquier proceso que comparta la base puede reanudarlas. Probado con Postgres 14 a 18 y pgbouncer en modo transaction; en modo statement no funciona (rechaza las transacciones, con un error claro). Sin probar con Neon.
- **`codemod`, nuevo:** `npx @backendkit-labs/codemod <nombre> ./src` con `scope-rename`, `coding-split`, `terminal-app-split` y `zod4-record`; `--list` y `--dry-run`. Probado contra la migración manual de `mcp-server` y sobre `aiops-agent`; `coding-split` solo con fixtures. Guía: [Migrate between versions](https://backendkit-agent-framework.vercel.app/guides/migrate-between-versions/).

## v0.46.0 (2026-11-17)

El banco de pruebas `audit-desk` (una auditoría exhaustiva con Redis real, procesos reales y un kill duro) destapó dos fallos del motor de flujos y permitió probar por primera vez los scripts Lua de Redis; de ahí sale además un journal nuevo para un host ([SPEC-0024](docs/specs/SPEC-0024-journal-de-corridas-ndjson.md), el diseño del journal de Steward llevado al SDK). En 0.x, `^0.44` no cubre 0.45, así que se barrieron los rangos de `agent-core` (`^0.45.0`) y los peers anchos pasan a `<0.46.0`. Solo suben los paquetes afectados; `web-ui` cambió solo su README y no sube; `mcp-connectors`, `agent-protocol` y `agent-web-ui` no cambian.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.45.0 | `NdjsonRunJournal` (+ `JournalCorrupt`, `JournalConflict`), vallado en `runFlow`, `FileRunJournal` sin contención, `flow_wait`, flujos con puerta humana en `FlowHost` |
| `agent-flow-queue` | 0.1.2 | un paso instantáneo ya no espera hasta el plazo por un aviso perdido (`pollMs`); el peer de `agent-core` sube a `>=0.43.0 <0.46.0` (el `>=0.42.0` de 0.1.1 era erróneo: usa `foldEvents`, que existe desde 0.43.0) |
| `agent-coding` 0.32.3, `agent-enterprise` 0.11.2, `mcp-server` 0.19.7, `agent-web` 0.6.12, `agent-providers` 0.3.12, `agent-sandbox` 0.1.15, `agent-testkit` 0.1.15, `agent-otel` 0.1.18, `document-extract` 0.1.8, `aval-tools` 0.1.22, `create-bk-agent` 0.24.2 | patch | solo el rango de `agent-core` (y los templates) |

- **`agent-core`, `NdjsonRunJournal` (SPEC-0024 F1 y F2):** un journal de corridas para **un host**, con un archivo `<runId>.ndjson` por corrida. Cadena de integridad entre líneas (HMAC con `key`, o SHA-256 sin ella: quitar, cambiar, añadir o reordenar una línea da `JournalCorrupt`, y `list` la aparta sin esconder las demás), `fsync` por evento, línea cortada ignorada y recortada antes de la siguiente escritura, archivos `0o600`. Un escritor por corrida, con **vallado**: si otro escribe en el archivo, este escritor recibe `JournalConflict`. El claim es un archivo de bloqueo con el pid del proceso: un dueño **muerto** se releva al instante (con Redis había que esperar el TTL; medido: 10-18 ms tras un SIGKILL), uno vivo se respeta por mucho que tarde, y el TTL se ignora. Medido en Windows: escribe 3,0 frente a 9,1 ms/evento y lee 400 eventos en 9,5 frente a 555 ms respecto a `FileRunJournal`. Asume un host (para varias máquinas, `RedisRunJournal`); quitar las **últimas** líneas deja una cadena válida (haría falta un ancla fuera del archivo).
- **`agent-core`, vallado en `runFlow`:** un `JournalConflict` en cualquier escritura se trata como el claim perdido: la corrida se detiene, no escribe más y `runFlow` lanza `FlowClaimError`. Cierra un hueco real: tras perder el claim, un paso en vuelo que terminaba todavía escribía en el journal.
- **`agent-core`, `FileRunJournal` ya no falla con un fan-out ancho:** con más de ~20 pasos terminando a la vez los `append` competían por el mismo número de evento y agotaban sus 20 reintentos (`too much contention`, incluso en un solo proceso); como el journal falla cerrado, la corrida acababa `failed`. Los `append` de una corrida se serializan ahora en el proceso y la competencia entre procesos reintenta con jitter con `@backendkit-labs/retry`.
- **`agent-flow-queue`, un paso instantáneo no vuelve a esperar hasta el plazo por un aviso perdido:** BullMQ anuncia el fin de un job por un flujo de eventos (`XREAD ... $`), y un aviso emitido antes de que un `QueueEvents` recién creado empiece a leer no se entrega nunca. Un paso que termina en milisegundos en una cola usada por primera vez (el paso `report` de `audit-desk`, en 2 de cada 3 reanudaciones tras matar el orquestador) esperaba hasta `timeoutMs` y fallaba aunque el worker lo hubiera completado. `QueueStepExecutor` mira ahora el propio job cada `pollMs` (por defecto 1000; 0 lo apaga). Los tests con mocks no podían verlo.
- **`agent-core`, `flow_wait` en `createFlowTools`:** espera a que una corrida deje de estar `running` (done, failed, cancelled, paused, awaiting_approval) o venza el plazo (por defecto 30 s, máximo 60 s) y devuelve su estado con `timedOut`. Sin ella, un agente que supervisa flujos sondeaba con `flow_status`, un turno de modelo por consulta. Es `readOnly` (varias esperas de un mismo turno corren en paralelo), respeta la señal del turno y admite `waitPollMs`.
- **`agent-core`, un flujo con puerta humana alojado en `FlowHost` ya no acaba `failed`:** con `flowFromDefinition`, un paso con `gate.approval: human` dejaba la corrida en `failed` ("flow awaiting_approval"), y el `flowRunId` del host no era el `runId` de `runFlow`, así que un supervisor no podía saber el id de la aprobación. Ahora `FlowControl` trae `runId` y `flowFromDefinition` lo usa para el journal y las aprobaciones (la aprobación de un paso es `stepApprovalId(flowRunId, stepId)`); la corrida queda `awaiting_approval` (`FlowAwaitingApproval`, exportada), `resume` la continúa desde el journal una vez decidida y `cancel` funciona mientras espera. Quien implemente `FlowControl` a mano debe añadir `runId`. Hallado al construir el agente `captain` de `release-captain`.
- **Verificado contra Redis real por primera vez:** los scripts Lua de `RedisRunJournal` (40 `begin`, 300 appends y 30 `claim` simultáneos; renovación; expiración) y la cola con workers en otros procesos pasan contra un Redis 7.4 en contenedor.
- **Tests:** tres tests de la renovación del claim (v0.45.0) dependían de TTLs de 60-90 ms y fallaban bajo la carga de la suite completa: ahora con holgura.

## v0.45.0 (2026-11-17)

Tres arreglos del motor de flujos que halló el banco de pruebas del research desk, y los docs de v0.44.0 en los paquetes. En 0.x, `^0.43` no cubre 0.44, así que se barrieron los rangos de `agent-core` (`^0.44.0`) y los peers anchos pasan a `<0.45.0`. Solo suben los paquetes afectados; `mcp-connectors` y `agent-web-ui` no cambian (su rango ya cubre las versiones nuevas).

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.44.0 | claim renovado mientras el run vive, `when` en los pasos, `FlowResult.costUsd` |
| `agent-protocol` 0.7.1, `agent-flow-queue` 0.1.1 | patch | solo el README (aprobaciones 1.2; cola BullMQ y journal Redis con ejemplos) |
| `agent-coding` 0.32.2, `agent-enterprise` 0.11.1, `mcp-server` 0.19.6, `agent-web` 0.6.11, `agent-providers` 0.3.11, `agent-sandbox` 0.1.14, `agent-testkit` 0.1.14, `agent-otel` 0.1.17, `document-extract` 0.1.7, `aval-tools` 0.1.21, `create-bk-agent` 0.24.1 | patch | solo el rango de `agent-core` (y los templates) |

Tres arreglos del motor de flujos que halló el banco de pruebas del research desk (`agent-framework-examples/trading-bot`, hallazgos 6, 7 y 9):

- **`agent-core`, el claim de un run se renueva mientras el run vive:** antes `claimTtlMs` (10 min por defecto) era la vida del claim desde que se tomaba, y un run más largo podía ser tomado por otro proceso **mientras el primero seguía corriendo** (un paso con efecto externo habría corrido dos veces). Ahora `runFlow` lo renueva cada `claimRenewMs` (por defecto un tercio del TTL) y el claim solo expira cuando el proceso se detiene. Si una renovación encuentra el claim en manos de otro, el run se detiene, no escribe sobre el nuevo dueño y `runFlow` lanza `FlowClaimError`. `claimRenewMs: 0` apaga la renovación (para simular un proceso caído). **Comportamiento nuevo:** un run con journal mantiene un temporizador (sin `ref`) mientras corre.
- **`agent-core`, pasos condicionales:** `when: { step, contains | equals | matches, not? }` en un paso. Si la condición no se cumple, o no se puede evaluar porque el paso que mira no produjo salida, el paso queda `skipped` antes de cualquier otra cosa: no corre, no se pide aprobación, los pasos que lo esperan se saltan y el flujo **no** falla. `validateFlow` exige que `when.step` esté en `after` y que `matches` sea una expresión válida. Nuevo tipo `FlowCondition`.
- **`agent-core`, el resultado trae el coste:** `FlowResult.costUsd` suma los `costUsd` de los pasos (ausente si ninguno lo reportó); también al responder un run terminado desde el journal.

## v0.44.0 (2026-11-17)

Motor de flujos ([SPEC-0023](docs/specs/SPEC-0023-flujos-declarativos.md)), protocolo 1.2 y ciclo de vida de la lección ([SPEC-0022](docs/specs/SPEC-0022-ciclo-de-vida-de-la-leccion.md)). `orchestrator-agent` se retira del framework (se absorbe en las librerías; la app vive en `bk-platform`). En 0.x, `^0.42` no cubre 0.43 y `^0.10` no cubre 0.11, así que se barrieron los rangos: `agent-core` `^0.43.0`, `agent-enterprise` `^0.11.0`, `agent-protocol` `^0.7.0`, y los peers anchos pasan a `<0.44.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.7.0 | protocolo 1.2: `ApprovalHandler`, estados `awaiting_approval` y `lost`, `CONFLICT` |
| `agent-core` | 0.43.0 | `FlowDefinition` y loader, `runFlow` (oleadas, topes, `StepExecutor`, `onStepFailure`, `timeoutMs`), `RunJournal` (memoria y archivos, reanudar), aprobación por paso, `planFlow`, `createApprovalHandler` y `createFlowTools`, `foldEvents`/`journalMatches`; ciclo de vida de la lección |
| `agent-enterprise` | 0.11.0 | `FlowLoader` re-exporta el de core |
| `agent-flow-queue` | 0.1.0 (nuevo) | `QueueStepExecutor` / `createStepWorker` sobre BullMQ y `RedisRunJournal` (Lua sin probar contra Redis real) |
| `create-bk-agent` | 0.24.0 | quita la arquitectura `orchestrator` y su plantilla |
| `agent-coding` 0.32.1, `mcp-server` 0.19.5, `mcp-connectors` 0.2.5, `agent-web` 0.6.10, `agent-providers` 0.3.10, `agent-sandbox` 0.1.13, `agent-testkit` 0.1.13, `agent-otel` 0.1.16, `document-extract` 0.1.6, `aval-tools` 0.1.20 | patch | solo el rango de `agent-core` / `agent-enterprise` |

**Retirado:** `@backendkit-labs/orchestrator-agent` ya no está en el repo (última publicada 0.7.7). Sus piezas: planner → `planFlow`, ejecución → `runFlow`, run store → `RunJournal`, cola → `agent-flow-queue`, aprobaciones → `createApprovalHandler`. El servidor MCP/HTTP no se reconstruye.

### Ciclo de vida de la lección (SPEC-0022)

[SPEC-0022](docs/specs/SPEC-0022-ciclo-de-vida-de-la-leccion.md) F1-F4: el ciclo de vida de la lección. **Cambia el comportamiento de 0.42.0** (el aprendizaje ya publicado): una lección aprendida ya no caduca con la ventana si su sujeto se sigue llamando.

- **`agent-core`, la lección se queda mientras su sujeto se siga llamando:** el banco de pruebas mostró que una lección que funciona perdía sus fallos en la ventana, caducaba y el error volvía (19 rechazos en 245 sesiones). Ahora sale cuando el sujeto no tiene llamadas ni fallos durante `quietAfterDays` (por defecto, la ventana) o cuando una persona la resuelve. Un patrón sin sujeto (una señal de un vertical) sigue saliendo con su ventana. **Consecuencia:** un fallo pasajero (una caída de tres timeouts) deja su lección mientras la tool se llame, hasta que alguien la resuelva.
- **`agent-core`, registro de patrones:** `learning.records()` (estado, línea, fechas) y `learning.resolve(patternKey, by, { tenantId?, reason? })`, solo para quien permita `approverKinds`. Un patrón resuelto que vuelve a fallar queda activo y su registro lo dice (`reappeared`).
- **`agent-core`, el texto de una lección ya no cambia al reiniciar:** la línea se escribe una vez en el registro del patrón (antes vivía solo en memoria y se reescribía desde el último fallo). Una pista que el autor de una tool mejora después llega a los patrones nuevos, no a los ya escritos.
- **`agent-core`, la propuesta de regla muestra la evidencia:** `3 x tool_error on place_order (3 of 10 calls, 30%), primera a última`, y si el patrón había sido resuelto, que volvió.
- **`agent-core`, los patrones que fallan ahora van antes** que las lecciones que se quedan solo porque su sujeto se sigue llamando, para que estas no ocupen el sitio de un problema nuevo.
- **Migración:** los `counters.json` de 0.42.0 guardan los patrones como `qualified`; se siguen leyendo hasta que el patrón se confirme y se reemplacen por un registro completo. Los contadores se conservan `2 x max(ventana, quietAfterDays)` días.

## v0.43.0 (2026-11-16)

Aprendizaje, segunda iteración ([SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F1 y F2) y las piezas del framework que un bot de trading de papel tuvo que escribir a mano. En 0.x, `^0.41` no cubre 0.42 y `^0.9` no cubre 0.10, así que se barrieron los rangos de los paquetes y templates que los usan: `agent-core` `^0.42.0`, `agent-coding` `^0.32.0`, `agent-enterprise` `^0.10.0`. Los peers con rango ancho (`<0.43.0`) ya cubrían 0.42.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.42.0 | aprendizaje con señal (éxitos contados, ventana, tasa) y lecciones por tool; `engine.run()` devuelve `RunResult`; `ToolError`; `learnedRules` |
| `agent-coding` | 0.32.0 | guarda el aprendizaje con `createLearning({ dir })` y los contadores en `counters.json` |
| `agent-enterprise` | 0.10.0 | igual que coding, con su almacén de reglas |
| `create-bk-agent` 0.23.10, `mcp-server` 0.19.4, `mcp-connectors` 0.2.4, `agent-web` 0.6.9, `agent-providers` 0.3.9, `agent-sandbox` 0.1.12, `agent-testkit` 0.1.12, `agent-otel` 0.1.15, `orchestrator-agent` 0.7.7, `document-extract` 0.1.5, `aval-tools` 0.1.19 | patch | solo el rango de `agent-core`, `agent-coding` o `agent-enterprise` (y los templates) |

Los demás paquetes no cambian: `agent-protocol` y `agent-web-ui`.

### Qué cambia al actualizar

- **`engine.run()` devuelve `RunResult`** en lugar de `void`. Quien hacía `await engine.run(x)` y no usaba el valor no nota nada; un tipo que espere `Promise<void>` hay que ajustarlo.
- **Argumentos mal formados:** `defineTool` lanza `ToolArgumentError` (código `INVALID_ARGUMENTS`) en lugar de devolver el texto como resultado. Cuenta como fallo de la tool en la auditoría y en el aprendizaje.
- **Con aprendizaje activado, cambia el system prompt:** las lecciones se agrupan por tool (`### post_invoice`), y un patrón necesita una tasa de fallo del 5 % desde 20 llamadas dentro de 30 días (antes bastaban 3 fallos). `rate: false` quita la tasa.
- Todo lo demás es aditivo.

### Detalle

Piezas que un bot de trading de papel (`agent-framework-examples/trading-bot`) tuvo que escribir a mano y que son de cualquier agente. Aditivas, salvo el tipo de retorno de `run`.

- **`agent-core`, `engine.run()` devuelve el resultado del turno** (`RunResult`): `text` (lo dicho tras la última tool), `toolCalls` (con `errorCode`, delegados incluidos), `errors`, `aborted`, `budgetExceeded` y `systemPrompts`. Antes devolvía `void`. Un único colector cubre todas las salidas del turno. El evento `tool_result` lleva `error_code` y el de `ask_agent`, `agent_id`.
- **`agent-core`, `emitSystemPrompt` (apagado por defecto):** evento `system_prompt` con el prompt de cada llamada al modelo. Apagado porque un system prompt puede llevar secretos y va a todos los transports.
- **`agent-core`, `engine.budgetExceeded`:** estado del presupuesto de coste, con o sin `abortOnBudget` (el evento `budget_exceeded` sigue atado a `abortOnBudget`).
- **`agent-core`, `ToolError(code, message)`:** error con código estable que el engine pone en la auditoría. `ToolArgumentError` lo extiende.
- **`agent-core`, `createLearning({ dir })`:** todo bajo un directorio con los nombres que coding ya usaba (`experiences.json`, `counters.json`, `proposals/`, `rules.json`, `lessons.json`); un almacén explícito sustituye a su archivo. `createCodingLearning` y `EnterpriseLearning` lo usan, sin mover ningún archivo.
- **`agent-core`, `learning.trackOutcome`:** atajo de `record` (`ok`, `subject`, `context`...). Un éxito sin `subject` se rechaza en vez de perderse.
- **`agent-core`, `Experience.context`:** el mismo `subject` juzgado aparte según las circunstancias; la proporción se mide dentro del contexto. Sin contexto, claves, ids de propuesta, texto de lección y contadores antiguos son idénticos.
- **`agent-core`, `stamp: 'clock'`:** las experiencias del sink, `record` y los contadores toman la hora de `now`, para simulaciones y backtests. Por defecto, la del evento.
- **`agent-core`, las tools leen las reglas aprobadas:** `learnedRules(ctx, guard)` y `LEARNED_RULES_SERVICE`. `createBaseEngine({ learning })` da a las tools una **vista de solo lectura** de las reglas del tenant del engine, nunca el objeto `Learning`: con él una tool podría aprobar haciéndose pasar por una persona. Se mezcla con `services` sea objeto o función.

Arreglos encontrados al probar F1 y F2 con un bot de trading de papel (`agent-framework-examples/trading-bot`, con su `FINDINGS.md`).

- **`agent-core`, una lección que funciona ya no se borra sola:** la proporción de fallos (`rate`) decide cuándo *entra* un patrón; una vez dentro, se queda mientras sus fallos estén en la ventana. Antes, al obedecer la lección, las llamadas correctas diluían la proporción, el patrón y su lección salían y el error volvía (27 rechazos en 19 operaciones). Un patrón sale cuando sus fallos salen de la ventana y tiene que volver a pasar la proporción para reentrar. El patrón calificado se guarda en el almacén de contadores.
- **`agent-core`, los argumentos mal formados son un error con código:** `defineTool` lanza ahora `ToolArgumentError` (código `INVALID_ARGUMENTS`) en lugar de devolver el texto como resultado. El modelo ve el mismo `Error: Invalid arguments ...`, pero la auditoría ya no lo cuenta como éxito y el aprendizaje puede aprender de ello, con una frase del engine (`ENGINE_ERROR_CODES`) que el autor de la tool puede sustituir con `errorHints`. **Cambia el comportamiento** de quien llame a `execute` de una tool de `defineTool` directamente: ahora rechaza en vez de devolver una cadena.
- **`agent-core`, la línea de una lección dice el consejo, no el último símbolo:** con `detail`, la línea es `tipo keeps happening: detail`; sin él, la situación. Antes llevaba la situación de la última experiencia (p. ej. `BBB-SIM`) aunque el patrón abarcara varios símbolos, y el modelo la tomaba como específica de ese símbolo.
- **Documentación:** `Experience.subject` y `rate` explican que la proporción es la del sujeto y que el contexto va en el sujeto.

[SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F1 (la señal del aprendizaje).

- **`agent-core`:** los éxitos se cuentan en vez de guardarse (contadores por día, agente y sujeto), los patrones solo miran los fallos de la ventana (`window`, 30 días por defecto) y una tool con muchas llamadas necesita que los fallos sean una proporción de ellas (`rate`, 5 % desde 20 llamadas por defecto; `rate: false` cuenta solo fallos). `AuditEvent.errorCode` lleva el código del error (`code` o nombre de la clase, nunca el mensaje) y es parte de la clave del patrón: fallos de la misma tool con causas distintas son patrones distintos. **Cambia el comportamiento por defecto:** un fallo de hace más de 30 días ya no cuenta y tres fallos entre mil llamadas ya no forman patrón.
- **`agent-coding` y `agent-enterprise`:** guardan los contadores en un archivo (`counters.json`).

[SPEC-0019](docs/specs/SPEC-0019-aprendizaje-segunda-iteracion.md) F2 (lecciones que enseñan).

- **`agent-core`, cambia el texto del prompt:** las lecciones se agrupan en unidades, una por tool (`### post_invoice`) y `general` primero; dentro de cada una, lo que enseñó una persona va antes de lo aprendido. La sección pasa a llamarse `## Lessons` (antes `## Taught lessons` y `## Lessons learned`). `lessons.maxPerUnit` (3 por defecto) acota lo aprendido por unidad, y el tope de `maxChars` quita entradas enteras desde el final en vez de cortar una por la mitad.
- **`agent-core`, el consejo lo pone quien conoce el dominio:** `ToolDefinition.errorHints` (y `defineTool({ errorHints })`) dice qué hacer por código de error (`*` para cualquiera). `createBaseEngine` los registra al recibir `learning`. Solo vale para los errores que lanza la tool: para los que el engine ve solo (denegación, bloqueo, timeout, resultado demasiado grande...) hay una frase fija (`ENGINE_HINTS`), así que una pista `*` nunca dice que se repita una llamada rechazada. Los topes (`maxPerUnit`, `maxLessons`) conservan las lecciones más frecuentes, y lo que enseñó una persona se recorta después de lo aprendido.
- **`agent-core`, unidades revisables en git:** `learning.exportUnit`, `learning.importUnit` (el archivo entra entero o no entra, es idempotente y conserva el orden y el primer autor; `replace` olvida lo que salió del archivo; `{ tenantId }` fija el tenant en vez del del front matter) y `learning.units()`. `teach` acepta `unit` e `id`. `EnterpriseLearning` las ofrece sobre su tenant.

## v0.42.0 (2026-11-15)

En 0.x, `^0.40` no cubre 0.41 y `^0.8` no cubre 0.9, así que se barrieron los rangos de todos los paquetes y templates: `agent-core` `^0.41.0`, `agent-coding` `^0.31.0`, `agent-enterprise` `^0.9.0`, y en los peers `<0.43.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.41.0 | módulo `createLearning`, opción `learning`, `teach`, `addRule`, tenants; obsoletos `ReflectionEngine`, `ProceduralMemory` y compañía |
| `agent-coding` | 0.31.0 | **cambia el comportamiento:** con `orchestration`, las reglas aprendidas esperan aprobación y `reflection` ya no está activo por defecto |
| `agent-enterprise` | 0.9.0 | `EnterpriseLearning` y `VaultRuleStore`; `EnterpriseReflection` obsoleto |
| `create-bk-agent` 0.23.9, `mcp-server` 0.19.3, `mcp-connectors` 0.2.3, `agent-web` 0.6.8, `agent-providers` 0.3.8, `agent-sandbox` 0.1.11, `agent-testkit` 0.1.11, `agent-otel` 0.1.14, `orchestrator-agent` 0.7.6, `document-extract` 0.1.4, `aval-tools` 0.1.18 | patch | solo el rango de `agent-core`, `agent-coding` o `agent-enterprise` |

Los demás paquetes no cambian: `agent-protocol` y `agent-web-ui`.

### Migración

- **`agent-coding` con `orchestration`:** si dependías de que las reglas aprendidas se aplicaran solas desde `manifest.yaml`, ahora quedan pendientes en `~/.{appName}/projects/<proyecto>/learning/`. Se aprueban con `createCodingLearning({ appName, projectRoot }).approve(id, { kind: 'human', id })`. El `manifest.yaml` anterior se sigue leyendo. `reflection: true` reactiva el motor anterior.
- **Nada más se retira:** `ReflectionEngine`, `DomainRegistry`, `FailureCatalog`, `PatternDetector`, `PolicyPromoter`, `ProceduralMemory` y `EnterpriseReflection` siguen funcionando, solo marcados `@deprecated`.

[SPEC-0017](docs/specs/SPEC-0017-un-contrato-por-concepto.md) F6 (autoaprendizaje). Aditivo en `agent-core` y `agent-enterprise`; **cambia el comportamiento** de `agent-coding` con `orchestration`.

- **`agent-core`:** módulo `createLearning` con experiencias, lecciones en el prompt y reglas propuestas que esperan a una persona. `MemoryApprovalStore` y `FileRuleStore`. `ReflectionEngine`, `DomainRegistry`, `FailureCatalog`, `PatternDetector`, `PolicyPromoter` y `ProceduralMemory` quedan `@deprecated`; se retiran en un minor posterior.
- **`agent-core`, opción única y tenants:** `createBaseEngine({ learning })` conecta el sink, el hook y, si el engine ya está en la ruta de política, las reglas aprobadas. Las experiencias llevan `tenantId` (el de `identity`), y patrones, lecciones, propuestas y reglas no cruzan tenants. El texto de una lección ya no lleva conteo ni fecha, para no invalidar la caché del prompt. El detalle que viene de una tool se sanea por separado.
- **`agent-core`, enseñar algo concreto:** `learning.teach(...)` guarda una lección escrita por una persona, sin esperar tres fallos: entra al prompt como `Taught lessons`, saneada y con tope de 500 caracteres, dentro de su tenant, y se puede limitar a un agente o a las tools que tenga en el turno. `learning.taught()` y `learning.forget(id)`. `learning.addRule(...)` añade una regla validada y atribuida a una persona. Solo quien permita `approverKinds` (por defecto una persona): un agente no puede enseñarse a sí mismo. `FileLessonStore` y `MemoryLessonStore`. `EnterpriseLearning` y `createCodingLearning` los guardan en archivos.
- **`agent-coding`:** con `orchestration`, los hallazgos de auditoría alimentan el aprendizaje (`createCodingLearning`, opción `learning`). Las reglas aprendidas **ya no se promueven solas** a `manifest.yaml`: quedan pendientes en `~/.{appName}/projects/<proyecto>/learning/` hasta que una persona las aprueba (`learning.approve`), y el orquestador las aplica. `reflection` deja de estar activo por defecto (`reflection: true` lo reactiva). El `manifest.yaml` anterior se sigue leyendo.
- **`agent-enterprise`:** `EnterpriseLearning` (umbral por severidad, la persona decide, reglas en el YAML del vault con `VaultRuleStore`). `EnterpriseReflection` queda `@deprecated`. `FlowRunner.reflection` acepta cualquier objeto con `recordGateOutcome`. `EnterpriseLearning` acepta `tenantId` y `VaultRuleStore` lo escribe en el YAML.

## v0.41.0 (2026-11-15)

[SPEC-0016](docs/specs/SPEC-0016-desamarrar-modulos-mixtos.md) F1–F3 (#182): la app de terminal sale de `agent-core`. **Con ruptura** en `agent-core` y `agent-coding`. En 0.x, `^0.39` no cubre 0.40, así que se barrieron los rangos de todos los paquetes y templates: `^0.40.0`, y en los peers `<0.42.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.40.0 | **rompe:** sin discovery, loader de skills, comandos integrados, workspace, checkpoint, trust ni seed; fuentes `agentSources`, `skillSources`, `instructionSources` |
| `agent-coding` | 0.30.0 | **rompe:** nuevo subpath `agent-coding/cli` con todo lo que salió de core |
| `mcp-server` 0.19.2 | patch | importa `SkillManager`, `SkillLoader` y `detectStack` de `agent-coding/cli`; requiere `agent-coding` ^0.30.0 |
| `create-bk-agent` 0.23.8, `agent-enterprise` 0.8.10, `agent-web` 0.6.7, `agent-providers` 0.3.7, `agent-sandbox` 0.1.10, `agent-testkit` 0.1.10, `agent-otel` 0.1.13, `orchestrator-agent` 0.7.5, `document-extract` 0.1.3, `aval-tools` 0.1.17 | patch | solo el rango de `agent-core` |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### Guía de migración

**Imports que se mueven.** Todo esto pasa de `@backendkit-labs/agent-core` a `@backendkit-labs/agent-coding/cli`: `discoverAgents`, `RemoteAgentRegistry`, `loadAgentsFromDir`, `globalAgentsDir`, `projectAgentsDir`, `SkillLoader`, `SkillManager`, `createSkillManager`, `parseMdSkill`, `skillToMd`, los proveedores de skills (`GitHubProvider`, `LocalProvider`, `SkillsShProvider`, `ObsidianProvider`), `registerBuiltinCommands`, los checkpoints, los workspaces, `runGlobalSeed`, `loadFrameworkConfig`, `DEFAULT_CONFIG` y el trust (`trustProject`, `isProjectTrusted`...).

**Siguen en core:** `SlashCommandRegistry`, `SkillRegistry`, `SkillActivator`, `cwdToProjectKey`, `getFrameworkDir`, `getProjectDir` y `atomicWrite`.

**`SkillActivator.detectStack`** pasa a la función `detectStack(cwd)` de `agent-coding/cli`.

**`agentDiscovery`** de `createBaseEngine` se sustituye por `agentSources`:

```ts
import { fileAgentSource } from '@backendkit-labs/agent-coding/cli';

createBaseEngine({ /* ... */ agentSources: [fileAgentSource({ appName: 'my-app' })] });
```

**Fuentes nuevas.** `skillSources` e `instructionSources` completan el trío. Las capas de instrucciones se sanean y entran al prompt por un hook `systemPrompt`, y un engine sin fuentes no toca el disco. `fileInstructionSource({ appName })` da `AGENT.md`, `USER.md`, contexto de proyecto, sesión y lecciones.

Quien usa `createCodingEngine` no cambia nada.

## v0.40.0 (2026-11-15)

[SPEC-0015](docs/specs/SPEC-0015-extraer-coding-de-los-contratos-de-core.md) F1–F4 (#179): el pipeline de coding sale de `agent-core`. **Con ruptura** en `agent-core` y `agent-coding`. En 0.x, `^0.38` no cubre 0.39, así que se barrieron los rangos de todos los paquetes y templates: `^0.39.0`, y en los peers `<0.41.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.39.0 | **rompe:** sin orquestador, QA, `store` ni `blockedCommands`; aprobación por hechos; `services` |
| `agent-coding` | 0.29.0 | **rompe:** el pipeline vive en `agent-coding/pipeline`; hooks de contexto |
| `create-bk-agent` 0.23.7, `mcp-server` 0.19.1, `agent-enterprise` 0.8.9, `agent-web` 0.6.6, `agent-providers` 0.3.6, `agent-sandbox` 0.1.9, `agent-testkit` 0.1.9, `agent-otel` 0.1.12, `orchestrator-agent` 0.7.4, `document-extract` 0.1.2, `aval-tools` 0.1.16 | patch | solo el rango de `agent-core` (y de `agent-coding` en `mcp-server`) |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### Guía de migración

**Pipeline de coding (orquestador y QA).** Las opciones `orchestrator`, `orchestratorFailureMode`, `qaService`, `noQA` y `onQAReview` desaparecen de `createBaseEngine` y `AgentEngine`. Se pasan como hooks:

```ts
import { Orchestrator, QAService, codingPipelineHooks } from '@backendkit-labs/agent-coding/pipeline';

createBaseEngine({ /* ... */ hooks: [codingPipelineHooks({ orchestrator, qaService, noQA, onQAReview, orchestratorFailureMode })] });
```

Quien usa `createCodingEngine` no cambia nada.

**Imports que se mueven.** `Orchestrator`, `QAService`, los tipos de orchestration y los hooks de reflection (`AuditHook`, `HistoricalLoader`, `LessonsMemoGenerator`…) pasan de `agent-core` a `agent-coding/pipeline`. Se elimina el subpath `agent-core/orchestration`. `agent-core/reflection` ya no hace falta: el núcleo se exporta desde la raíz.

**Aprobación de tools.** El engine ya no pregunta por `write_file`, `edit_file` ni `run_command` por su nombre. Una tool que antes preguntaba por llamarse así debe declarar `readOnly: false`. Para preguntar solo en ciertas llamadas, `alwaysAsk(args)`. El `packageInstallPolicy` de core pasa a `alwaysAsk` de `run_command`.

**`ExecutionContext`.** Se quitan `store` y `blockedCommands`, y las opciones `store` del engine. Se añade `services` (un `Record` o `(profile) => Record` en las opciones) y `getService(ctx, key)`. `agent-coding` usa las claves `coding.store` y `coding.blockedCommands`. `ProjectStoreData` y `SessionUpdates` pasan a `agent-coding`. `additionalRoots` se mantiene.

**System prompt.** Core solo escribe `## Working Directory`. La regla de rutas relativas y las notas del agente las añade `codingContextHooks`, al final del prompt.

## v0.39.0 (2026-11-14)

[SPEC-0014](docs/specs/SPEC-0014-puntos-de-extension-del-engine.md) completo (#171–#174): hooks de ciclo de vida, política y aprobación por llamada, aprobación durable y auditoría con un evento por llamada.

Sin cambio incompatible. Todo lo nuevo es opcional, y sin configurarlo el engine se comporta igual. `agent-core` sube a minor porque añade API pública. En 0.x, `^0.37` no cubre 0.38, así que se barrieron los rangos de todos los paquetes y templates: `^0.38.0`, y en los peers `<0.40.0`. Cada paquete que depende de core sube un patch solo por ese rango.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.38.0 | SPEC-0014: `policy`, `approver`, `approvals`, `audit`, `identity`, `hooks`; `FileApprovalStore`, `runApproved`, `consultAgent`; sinks de auditoría; servidor de tools con los mismos contratos |
| `mcp-server` | 0.19.0 | `AgentMCPServer` acepta `policy`, `approver`, `identity` y `auditSink` para las tools directas; requiere `agent-core` ^0.38.0 |
| `create-bk-agent` | 0.23.6 | templates con `agent-core` ^0.38.0; `add server` y `add knowledge` instalaban `mcp-server` ^0.15 y `enterprise` ^0.1 (en 0.x, versiones antiguas) y ahora piden ^0.19.0 y ^0.8.8 |
| `agent-coding` 0.28.5, `agent-enterprise` 0.8.8, `agent-web` 0.6.5, `agent-providers` 0.3.5, `agent-sandbox` 0.1.8, `agent-testkit` 0.1.8, `agent-otel` 0.1.11, `orchestrator-agent` 0.7.3, `document-extract` 0.1.1, `aval-tools` 0.1.15 | patch | solo el rango de `agent-core` |

Los demás paquetes no cambian: `agent-protocol`, `mcp-connectors` y `agent-web-ui`.

### `mcp-server`: gobernanza de las tools directas (SPEC-0014 F4)
- `AgentMCPServer` reenvía `policy`, `approver`, `identity` y `auditSink` a sus `directTools`. Son los mismos contratos que el engine y que `createToolServer`.
- Una tool directa `destructive` puede tener como gate una `policy` en vez de `authorize`.
- `audit(ToolCallRecord)` queda obsoleto, sin cambios.

### `agent-core`: contratos de gobernanza y auditoría por llamada ([SPEC-0014](docs/specs/SPEC-0014-puntos-de-extension-del-engine.md) F0–F1)
Sin cambio incompatible: todo es opcional y el engine se comporta igual si no se configura.
- **Contratos** (exportados desde la raíz): `Principal`, `Identity`, `ToolCall`, `PolicyDecision`, `ToolPolicy`, `ApproverRef`, `ApprovalSubject`, `ApprovalRequest`, `ApprovalOutcome`, `Approver`, `ApprovalStore`, `AuditEvent` y `AuditSink`. La política y la aprobación se conectan al engine en F2.
- **`audit` en `createBaseEngine` y `AgentEngine`:** uno o varios `AuditSink` reciben exactamente un `AuditEvent` por llamada a tool, sea permitida, fallida, con timeout, inexistente, no autorizada, rechazada o bloqueada por guardrail o por el sandbox. También reciben uno por cada delegación `ask_agent`.
  - Los argumentos van solo como SHA-256 del JSON canónico.
  - Las decisiones del sandbox durante la llamada van dentro del mismo evento.
  - Si un sink falla, se avisa en el transport y el resultado no cambia.
- **`identity`:** tenant, usuario y roles que forman parte del principal de cada llamada.
- **Sinks:** `MemoryAuditSink`, `NdjsonAuditSink` y `HashChainAuditSink`. Este último encadena hashes con HMAC opcional y se verifica con `verifyAuditChain` y `verifyAuditSegment`; es el mismo esquema que la gobernanza de Steward. Se rechaza extender un log que ya está alterado.
- **`auditLog` (ruta a NDJSON) queda obsoleto** sin cambiar su formato: sigue escribiendo hasta 200 caracteres de argumentos en claro. Se retira en 0.40.
- **Base común (F0):** `hashArgs` y `canonicalJson` en un solo módulo; `isLoopbackRequest` en un solo sitio, que `mcp-server` reexporta.

### `agent-core`: política y aprobación por llamada (SPEC-0014 F2)
Sin cambio incompatible. La ruta nueva se activa solo al configurar `policy`, `approver` o `approvals`. Sin ellas, `onToolApproval` se comporta exactamente igual que antes.
- **`policy`:** una o varias `ToolPolicy` deciden `allow`, `deny` o `ask` sobre cada llamada a tool y cada delegación `ask_agent`. Deciden sobre los argumentos que de verdad se ejecutarían, después de `allowedTools`, el sandbox y los guardrails.
  - Si hay varias, `deny` gana sobre `ask`, y `ask` gana sobre `allow`.
  - Una política que lanza un error deniega.
  - `allow` puede pedir los modos `sandboxed` o `dry_run`. Este último hace que la tool vea `ctx.dryRun`.
- **`defaultToolPolicy`:** se aplica cuando hay a quién preguntar y no se dio `policy`. Lo `readOnly` se ejecuta. Lo `destructive` pregunta siempre a una persona. Lo demás pregunta.
- **`approver`:** responde a cada `ask`. Puede ser una persona, otro agente o un servicio como Hermes. El engine valida cada respuesta: el tipo de aprobador debe estar aceptado, nadie se aprueba a sí mismo ni a su cadena, y un agente solo aprueba lo que él mismo puede hacer. La auditoría registra quién aprobó.
  - Sin `approver`, se adapta `onToolApproval` con `approverFromCallback`. "Aprobar todo" nunca cubre lo destructivo ni la instalación de paquetes.
- **`approvals`:** si nadie responde en el momento, la llamada queda pendiente en el almacén y no se ejecuta. Si no hay nadie a quién preguntar, se rechaza.
- **Contexto de cada tool:** `ctx.principal` con el agente, su cadena de delegación y la identidad del engine. La cadena se propaga en las delegaciones.

### `agent-core`: hooks de ciclo de vida (SPEC-0014 F3)
Sin cambio incompatible: sin `hooks` el engine no cambia.
- **`hooks: EngineHooks[]`:** seis puntos de enganche.
  - `beforeRun`: antes de que empiece el turno.
  - `systemPrompt`: añade secciones al prompt del agente activo y al de los delegados.
  - `afterTurn`: se llama cuando el modelo responde sin pedir tools. Puede forzar otra pasada con `{ action: 'continue', agentId?, message? }`, con un tope de `maxHookContinues` (5 por defecto).
  - `beforeTool` y `afterTool`: envuelven solo las llamadas que la política permitió.
  - `afterRun`: al terminar el turno.
- **Turno:** los hooks se ejecutan en orden de registro y comparten un `RunContext` (principal, input, `state` y `signal`).
- **Errores:** un hook que lanza falla el turno, igual que un orquestador en modo `closed`.
- **Pipeline de coding:** se puede expresar solo con hooks (hay un test que lo demuestra). Se migrará en SPEC-0015.

### `agent-core`: servidor de tools con los mismos contratos, y aprobación durable (SPEC-0014 F4–F5)
Sin cambio incompatible.
- **`createToolServer`** acepta `policy`, `approver`, `identity` y `auditSink`.
  - `auditSink` recibe el mismo `AuditEvent` que el engine.
  - Un `ask` sin aprobador se rechaza.
  - Una tool `destructive` arranca con `authorize` o con `policy`.
  - Cada tool recibe `ctx.principal`, y `ctx.dryRun` cuando la política pide simular.
  - `audit(ToolCallRecord)` queda obsoleto, sin cambios.
- **`FileApprovalStore`:** guarda las aprobaciones pendientes en un directorio. Admite una sola decisión y una sola ejecución por id. Cada paso es atómico entre procesos, sin locks, y la petición sobrevive a reinicios.
- **`engine.runApproved(id)`:** ejecuta, como mucho una vez, una llamada que quedó pendiente y luego fue aprobada. Repite todas las comprobaciones, y la aprobación solo cuenta si su aprobador es de un tipo aceptado.
- **`engine.consultAgent(id, pregunta)`:** permite preguntarle algo a otro agente.
- **`agentApprover`:** un agente supervisor como aprobador. Responde APPROVE o REJECT.
- **`consoleApprover`:** una persona en la terminal como aprobador, con y/N.
- **Regla 3 precisada:** un agente aprueba si la política, evaluada con él como principal, le daría `allow`, o un `ask` que un agente puede satisfacer.

## v0.38.2 (2026-11-14)

Publicado en npm (los dos paquetes de la tabla, cada versión es `latest`) y taggeado `agent-core@0.37.2` y `mcp-server@0.18.6` sobre el merge del bump (a833d35e). Tools directas (sin LLM) servidas por MCP, [SPEC-0011](docs/specs/SPEC-0011-mcp-server-tools-directas.md) D1–D4 (#166); arreglo del CI que re-resolvía dependencias al instalar el binario de rolldown (#169). Patch en los dos paquetes: el cambio es aditivo y los rangos `^0.37.0` existentes (paquetes, templates, consumidores) toman `agent-core` 0.37.2 sin editar nada.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.2 | hechos declarados en `ToolDefinition`, `createToolContext`, servidor MCP de tools directas (`createToolServer`, `startToolServerHttp`, `runToolServer`, `createToolRegistrar`) |
| `mcp-server` | 0.18.6 | `AgentMCPServer` con `directTools`; `engineFactory` opcional; requiere `agent-core` ^0.37.2 |

Los demás paquetes no cambian.

El framework queda como SDK para crear agentes; la infraestructura vive en `bk-platform` (mismos nombres npm, versiones sin cambio). Salen de este repo: `hermes` (0.4.0), `curator-codex-agent`, `dataset-curator-agent` e `infra`; las specs SPEC-0003 y SPEC-0008 pasan a `bk-platform/docs/hermes`. `orchestrator-agent` sigue aqui hasta que `bk-platform` migre a zod 4. Tambien salen `apps/docs` y `apps/bk-agent`.

### `agent-core`: servidor MCP de tools directas y hechos declarados de una tool ([SPEC-0011](docs/specs/SPEC-0011-mcp-server-tools-directas.md))
Sin cambio incompatible: los campos nuevos son opcionales y están ausentes si no se declaran; `AgentToolDef` y `AgentMCPServer` de `mcp-server` no cambian.
- **`ToolDefinition` / `defineTool`:** `title`, `readOnly` (implica `concurrencySafe`), `destructive`, `idempotent`, `openWorld` y `meta` (libre, el engine no lo lee). Las contradicciones (`readOnly` + `destructive`, `destructive` + `concurrencySafe`, `timeoutMs` no positivo, `parameters` que no es objeto) lanzan `ToolDefinitionError` al definir la tool. `validateToolDefinition(tool)` para tools escritas a mano; `getToolInputSchema(tool)` devuelve el esquema Zod con el que se definió.
- **`createToolContext(opts?)`:** `ExecutionContext` para ejecutar una tool fuera de un `AgentEngine` (memoria en proceso, `askAgent` que rechaza). `createInMemorySessionMemory()`.
- **`createToolRegistrar(opts)`:** valida las tools una vez y devuelve una función que las registra, con las mismas garantías, en cualquier `McpServer` (uno que también sirva tools de prompt o recursos).
- **`createToolServer(opts)` / `createToolServerFactory(opts)`** (también en `@backendkit-labs/agent-core/mcp`): expone `ToolDefinition`s como tools MCP que ejecutan directo, sin modelo. Las tools de `defineTool` se registran con su propio esquema Zod (sin conversión); las escritas a mano pasan por `z.fromJSONSchema` y fallan fuerte si el esquema no se puede expresar. Por llamada: `authorize` (obligatorio si alguna tool es `destructive`; el servidor no arranca sin él), `ExecutionContext` con `signal` que aborta por cancelación del cliente o por `timeoutMs`, tope de salida (`maxOutputChars`, 1 048 576) y registro `audit` con hash SHA-256 de los argumentos. Contrato: `isError` solo si la llamada no terminó (denegada, timeout, excepción sin stack, salida demasiado grande); lo que la tool devuelve es payload. `annotations` (`readOnlyHint`...), `title` y `_meta` salen de los hechos declarados.
- **`startToolServerHttp(opts, http)`:** Streamable HTTP sin estado (un servidor y un transporte por petición), bearer obligatorio comparado en tiempo constante, se niega a escuchar fuera de loopback sin token, 403 si `Host`/`Origin` no son loopback, solo `POST`, 413 por encima de `maxBodyBytes`.
- **`runToolServer(opts, cli)`:** la CLI `bk-mcp` de siempre (stdio por defecto, `--http --port --host --token`, variable de entorno configurable, `--help`); `parseToolServerArgs` y `toolServerUsage` sueltos.
- **`MCPClientManager`:** con `trustAnnotations: true` copia también `destructiveHint`, `idempotentHint`, `openWorldHint` y `_meta` (a `destructive`, `idempotent`, `openWorld`, `meta`); `readOnlyHint` sigue dando `concurrencySafe` y ahora también `readOnly`. `title` se copia siempre. Sin `trustAnnotations` nada cambia.

### `mcp-server`: `AgentMCPServer` sirve también tools directas (SPEC-0011 D4)
Sin cambio incompatible: `tools: AgentToolDef[]` y `buildPrompt` no cambian.
- **`directTools?: ToolDefinition[]`** junto a `tools`, con `authorize`, `audit`, `context`, `maxOutputChars` y `toolTimeoutMs`; se registran con `createToolRegistrar` de `agent-core` en el servidor de cada sesión (el `audit` recibe el id de sesión MCP).
- **`engineFactory` opcional**: un servidor solo con tools directas no necesita engine. El constructor lanza si hay tools de prompt sin `engineFactory`, si un nombre está en las dos listas o si una tool directa `destructive` no tiene `authorize`.
- **Requiere `agent-core` ^0.37.2** (`createToolRegistrar`).

## v0.38.1 (2026-10-28)

Publicado en npm (los 7 paquetes de la tabla, cada versión es `latest`) y taggeado `<paquete>@<versión>` sobre el merge del bump (56f43573). Correcciones de seguridad portadas desde el fork de Steward (inventario SPEC-0001 de Steward, G1–G10; #159–#162), el paquete nuevo `document-extract` ([SPEC-0012](docs/specs/SPEC-0012-extraccion-de-documentos.md), #163) y el cierre documental de v0.38.0 (#158). Sin cambio incompatible: los valores por defecto del modo estricto no cambian. Sin ejecutar en GitHub Actions (no arranca por facturación): build en el orden del CI, typecheck de todos los paquetes, tests con cobertura, `audit-gate`, `check-resilience` y `madge` se corrieron en local sobre el árbol integrado.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.1 | `appName` validado, `atomicWrite` con temporal único, saneo del contexto de disco, SSRF en el registro remoto |
| `agent-coding` | 0.28.4 | `realpath` en el sandbox de archivos, plazo en `search_files`, aviso de secretos en `save_*` |
| `agent-enterprise` | 0.8.7 | el gate de `FlowRunner` que no se puede evaluar falla en vez de pasar |
| `agent-web` | 0.6.4 | HMAC del webhook sobre bytes crudos; modo `strict` opcional |
| `agent-web-ui` | 0.1.3 | el token va como subprotocolo, nunca en la URL |
| `agent-protocol` | 0.6.2 | modo `strict` opcional; aviso al escuchar fuera de loopback sin `apiKey` |
| `document-extract` | 0.1.0 | **nuevo**: PDF, Word, Excel, CSV y OCR a texto |

Los demás paquetes no cambian (sus rangos `^0.37.0` y `<0.38.0` cubren `agent-core` 0.37.1).

### Correcciones de seguridad (#159, #160, #162)
- **`agent-coding`:** `resolveAndCheck` compara rutas reales: un enlace dentro del directorio de trabajo que apunta fuera ya no escapa del sandbox de las tools de archivo. `search_files` devuelve `Error: ...` en vez de lanzar. **Cambio visible:** leer por un enlace que sale del workspace ahora falla también sin sandbox.
- **`agent-coding` — `search_files`:** el patrón lo escribe el modelo y una expresión con retroceso catastrófico (`(a+)+$`) colgaba al agente varios segundos con 24 caracteres. La búsqueda corre ahora con un plazo de 5 s (`BK_SEARCH_FILES_TIMEOUT_MS`) y devuelve `Error: search stopped...` si lo agota.
- **`agent-core`:** `appName` solo admite letras, dígitos, guion y guion bajo (antes `../x` salía del home). `atomicWrite` usa un temporal único por escritura.
- **`agent-core`:** el contexto que se lee de disco (AGENT.md, USER.md, proyecto, sesión) se sanea antes de entrar al prompt: se quitan delimitadores de chat y etiquetas de rol, sin tocar genéricos ni marcado. El registro remoto de agentes valida el protocolo y no sigue a IP privadas distintas de su propio origen (no cubre DNS rebinding).
- **`agent-coding`:** `save_context`, `save_audit`, `save_learning` y `update_session` avisan si el texto parece contener secretos.
- **`agent-web`:** el HMAC del webhook se verifica sobre los bytes recibidos y no sobre `JSON.stringify(req.body)`.
- **`agent-enterprise` — `FlowRunner` (visible):** un paso cuyo gate declara `criteria` pero no se puede evaluar (el flujo no nombra `evaluator`, o falta `onGateRequired`) ahora **falla** con `ComplianceGateError` en vez de pasar en silencio. Un gate con `approval: human` no se bloquea: la persona es la evaluación. Transitorio: `allowUnevaluatedGates: true` restaura el comportamiento anterior.

### Modo estricto (opcional, no cambia los valores por defecto) (#161)
- **`agent-web`:** `new AgentServer({ strict: true })` no permite ningún origen CORS salvo los de `cors`, añade `X-Content-Type-Options`, `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`, y lanza si escucha en una interfaz no local sin `auth`. `new JwtAuth({ allowQueryToken: false })` ignora `?token=`; el navegador envía el JWT como subprotocolo `bearer, <jwt>`. El servidor selecciona `bearer` siempre (hace falta para ese cliente). `JwtAuth` acepta ahora ese subprotocolo también sin `strict`.
- **`agent-web-ui`:** `useAgentSession` y `useKanbanMonitor` aceptan `token` y lo envían como subprotocolo, nunca en la URL.
- **`agent-protocol`:** `new AgentServer({ strict: true })` lanza si `host` no es de loopback y no hay `apiKey`. Sin `strict`, esa combinación solo avisa al arrancar (`console.warn` nuevo).

### `document-extract` 0.1.0 (#163)
Texto de PDF con capa de texto, Word (.docx), Excel (.xlsx), CSV y texto, con límites (tamaño, páginas, ZIP descomprimido, caracteres) y errores de código estable; herramienta `read_document` que consulta el sandbox como `read_file`. OCR opcional de imágenes PNG/JPEG y PDF escaneados con `tesseract.js` (instalado, nunca descarga; sin él `OCR_UNAVAILABLE`); `@napi-rs/canvas` opcional para PDF que no son una imagen por página. Node ≥ 22. Límites conocidos en el [README](packages/document-extract/README.md) y en SPEC-0012 §4 y §6.

## v0.38.0 (2026-10-26)

Publicado en npm (los 14 paquetes, cada versión es `latest`) y taggeado `<paquete>@<versión>` sobre el merge del bump (4b74bc83). Sin verificar: el claim de aprobaciones entre procesos contra un Redis real; GitHub Actions no arranca por facturación, así que lo mergeado en 0.37.x–0.38.0 se validó solo en local.

Cierre de [SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) (O2–O5, #141–#156). **Cambio incompatible en `agent-core`** (#155): un agente solo puede llamar a las herramientas de su `allowedTools`. Rangos 0.x barridos: `agent-core ^0.37.0` y peers `<0.38.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.37.0 | `allowedTools` vacío = sin herramientas; `discoverAgents` con confianza del workspace; contexto de sub-agentes |
| `orchestrator-agent` | 0.7.2 | `applyGateDecision` testeable; aprobación de gates atómica entre procesos |
| `agent-web` | 0.6.3 | `SessionManager.get` sin escritura por mensaje; `SCAN`/`MGET` en Redis |
| `agent-enterprise` | 0.8.6 | escaneo del vault sin copias ni `stat` secuencial |
| `mcp-server` | 0.18.5 | sesiones HTTP con TTL y tope |
| `mcp-connectors` | 0.2.2 | token de gcal en single-flight |
| `agent-web-ui` | 0.1.2 | tokens aplicados por fotograma |
| `create-bk-agent` | 0.23.5 | `add mcp-client`/`add plugin` generan código que compila; plantillas sin código muerto y con `agent-providers` |
| `agent-coding` | 0.28.3 | solo el rango de `agent-core` |
| `agent-providers` | 0.3.4 | solo el peer de `agent-core` |
| `agent-otel` | 0.1.10 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.7 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.7 | solo el peer de `agent-core` |
| `aval-tools` | 0.1.14 | solo el rango de `agent-core` |

`agent-protocol` (0.6.1) y `agent-infra` no cambian.

**Orden de publicación:** core → providers → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server, mcp-connectors, web-ui) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **INCOMPATIBLE — `allowedTools: []` significa sin herramientas (`agent-core`).** Antes un agente con `allowedTools` vacío y sin `delegatesTo` podía ejecutar cualquier herramienta registrada si el modelo la llamaba por nombre. Ahora solo puede llamar a las que lista. Arreglo: poner en `allowedTools` los nombres de las herramientas que debe usar. Para ganar tiempo: `allowUnlistedTools: true` (en `AgentEngine` y `createBaseEngine`) restaura el comportamiento anterior solo para ese caso; no es para dejarlo puesto. Los perfiles de `agent-coding` y las plantillas `single` / `multi-agent` ya listan sus herramientas.
- **`discoverAgents` / `createBaseEngine({ agentDiscovery })` (`agent-core`): la capa de proyecto exige confianza del workspace.** Los agentes de `.{app}/agents/` del repositorio no se cargan salvo que el proyecto sea de confianza (`/trust add`, `BK_TRUST_PROJECT=1`) o el host pase `trusted: true`. Si no, no se abre ni se parsea ningún archivo y se avisa con los nombres. Era el mismo hueco que `AgentLoader` ya cerraba (SPEC-0009). Además, con un mismo id en proyecto y global, **gana el proyecto** (antes el global), y el directorio personal y la caché del registro usan `getFrameworkDir`.
- **Contexto (`agent-core`):** los sub-agentes aplican la compactación por tokens de `context` y reintentan una vez ante un error de contexto demasiado largo. `ContextManager` recorta además los resultados voluminosos de herramientas antiguos **dentro** de un turno largo (`keepRecentToolResults`, 4); afecta también al agente principal.
- **`orchestrator-agent`:** el claim de la aprobación de un gate también se toma en el store (Redis `SET NX PX`, o un archivo `<run>.claim` en disco, 5 min de TTL); dos procesos ya no pueden aprobar el mismo gate. No se ha probado contra un Redis real.
- **`agent-web`:** la última actividad de una sesión se persiste como mucho cada 30 s (`activityPersistIntervalMs`); `RedisLike` admite `scan`/`mget` opcionales.
- **`mcp-server`:** una sesión HTTP inactiva más de 30 min se cierra; con 1000 abiertas, las nuevas reciben 503 (`sessionTtlMs`, `maxSessions`).
- **`agent-web-ui`:** el texto en streaming llega a la UI hasta ~16 ms más tarde.
- **`create-bk-agent`:** las plantillas `single` y `multi-agent` generan proyectos que usan `@backendkit-labs/agent-providers` (y ya no fijan `openai ^4`); `add mcp-client` / `add plugin` registran el servidor con `mcpManager` en proyectos con `new AgentEngine`. Se eliminan las plantillas legacy de primer nivel.

## v0.37.2 (2026-10-26)

Cotas, cachés y exportación acotada ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O3, #136–#139). Solo patches: los rangos de los dependientes ya los cubren, sin barrido ni cambio en `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.2 | topes por defecto en memoria semántica (5000) y procedural (1000) |
| `agent-otel` | 0.1.9 | tags de los spans de core exportados por lista blanca |
| `agent-enterprise` | 0.8.5 | `ObsidianRAGProvider` guarda el índice por tiempo, no por batch |
| `orchestrator-agent` | 0.7.1 | cachés del store de runs (episódica) y del índice RAG |

**Orden de publicación:** core → enterprise → orchestrator-agent → otel.

### Cambios de comportamiento
- **`agent-core`:** `SemanticMemory` conserva las 5000 entradas más nuevas y `ProceduralMemory` 1000 patrones (descarta los menos confirmados). Se ajusta con `retention.maxKnowledge` / `maxPatterns`; `Infinity` quita el tope.
- **`agent-otel`:** un tag no listado en un span de core (`run`, `agent_block`, `llm_call`, `tool_call`) deja de exportarse. Los spans creados por la propia aplicación siguen pasando sus tags.
- **`agent-enterprise`:** nueva opción `checkpointIntervalMs` (30 s); `0` restaura el guardado por batch. Un crash pierde como mucho ese intervalo de indexación.
- **`orchestrator-agent`:** el índice RAG se reutiliza 2 min y la lista de pasos episódicos 60 s; una nota nueva del vault tarda hasta 2 min en verse para runs nuevos.

## v0.37.1 (2026-10-26)

Cotas y fugas ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O3, #128–#133). Solo patches: los rangos `^0.36`, `^0.3`, `^0.6` y `^0.18` de los dependientes ya los cubren, así que no hay barrido de rangos ni cambio en `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.1 | `MCPClientManager` cierra cliente y transport si la conexión falla (sin procesos stdio huérfanos) |
| `mcp-server` | 0.18.4 | `indexDirectory` con concurrencia acotada (16) |
| `agent-protocol` | 0.6.1 | `TaskStore` evicta tareas canceladas y las que nunca terminan (24 h) |
| `agent-providers` | 0.3.3 | sin reintento tras emitir razonamiento |
| `agent-otel` | 0.1.8 | `otlpHttpExporter` con cola acotada (`maxQueuedBatches`) |
| `agent-web` | 0.6.2 | backpressure en WebSocket |

**Orden de publicación:** core → providers → agent-protocol → (otel, mcp-server, web).

### Cambios de comportamiento
- **`agent-web`:** un cliente de sesión que deja más de 8 MiB sin leer se desconecta (código 1013 `slow consumer`); `new WebSocketTransport(socket, { maxBufferedBytes })` lo ajusta. A los observadores del monitor se les omiten frames pasado 1 MiB (`MonitorBus.droppedFrames`).
- **`agent-otel`:** con un collector lento, los lotes más antiguos por encima de `maxQueuedBatches` (32) se descartan y se avisa por `onError`; antes se acumulaban sin tope.
- **`agent-protocol`:** `evict(ttlMs, activeTtlMs)` descarta además tareas pending/running con más de 24 h.

## v0.37.0 (2026-10-26)

Auditoría de orquestación, límites y cotas ([SPEC-0010](docs/specs/SPEC-0010-cotas-por-defecto-y-orquestacion.md) O1–O3, #110–#126) y los ejemplos migrados a zod 4. Rangos 0.x barridos: `agent-core ^0.36.0` y peers `<0.37.0`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.36.0 | orquestación, límites y cotas (abajo) |
| `agent-coding` | 0.28.2 | `run_command` valida los binarios envueltos; rango de `agent-core` |
| `orchestrator-agent` | 0.7.0 | una gate por paso, plan validado, `approve` unificado |
| `agent-enterprise` | 0.8.4 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.3 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.13 | solo el rango de `agent-core` |
| `agent-web` | 0.6.1 | solo el rango y el peer de `agent-core` |
| `agent-otel` | 0.1.7 | solo el peer de `agent-core` |
| `agent-providers` | 0.3.2 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.6 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.6 | solo el peer de `agent-core` |
| `create-bk-agent` | 0.23.4 | plantillas con los rangos nuevos |

`agent-protocol`, `agent-infra`, `mcp-connectors` y `agent-web-ui` no cambian. Los 8 ejemplos de `examples/` y `finance-managment` pasan a zod ^4.6.6 y core 0.35.

**Orden de publicación:** core → providers → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **`orchestrate()` falla cerrado (`agent-core`).** Si el orquestador lanza, `run()` falla con `Orchestrator failed; refusing to run without its gates` en vez de ejecutar sin gates en silencio. Para el comportamiento anterior (con aviso `warn`): `orchestratorFailureMode: 'open'`.
- **Historial en memoria acotado a 200 mensajes por defecto (`agent-core`).** Antes era ilimitado. `maxContextMessages: 0` lo desactiva; no se aplica si configuras `context` (control por tokens).
- **`JsonFileStore` cambia de formato en disco (`agent-core`).** Pasa de un array JSON a un log de líneas JSON. Los archivos antiguos se leen y se convierten solos en la primera carga; una herramienta externa que lea esos archivos como array dejará de funcionar.
- **Delegaciones anidadas con tope (`agent-core`).** Un bulkhead por nivel de profundidad (antes las anidadas no esperaban nunca) y `maxDelegationDepth` (5): una delegación más profunda falla con `max_depth_exceeded`. `WorkflowRunner` limita las olas a `maxConcurrency` (8).
- **FSM de tareas (`agent-core`).** Se quita `approved → implementation` (volver a editar un cambio aprobado pasa por `rework_required`) y el rework tiene tope (`maxRework`, 5; agotado, la tarea se rechaza).
- **`QAService.evaluateReview` por palabras completas (`agent-core`).** Antes `broken` contenía `ok` y aprobaba. Veredictos de revisiones que antes salían aprobadas por error pueden cambiar.
- **`WorkflowRunner` (`agent-core`).** Un fallo salta toda la cadena de dependientes; un ciclo o una dependencia desconocida se reporta como `failed` en lugar de `completed` con pasos faltantes.
- **`abort()` cancela también las llamadas LLM de los sub-agentes (`agent-core`).**
- **`EpisodicMemory` y `MetricsCollector` (`agent-core`).** La summarization reemplaza los episodios que resume (antes solo añadía el resumen); los percentiles de runs son una estimación sobre un reservorio de 1024 (exactos por debajo).
- **`run_command` (`agent-coding`)** valida el binario que envuelven `env`, `xargs`, `timeout` y `find -exec`, y rechaza `$(…)`/backticks dentro de comillas dobles. Sigue siendo un guard rail: la contención real es el sandbox.
- **`orchestrator-agent`:** con varias gates en un mismo lote, cada una se pide por separado (antes solo la primera); el plan se rechaza con ciclos, ids duplicados o `agent_id` desconocido; `subtaskTimeoutMs` opcional; la ruta HTTP de `approve` ahora deja rastro de auditoría.

## v0.36.0 (2026-10-26)

Presupuesto diario aplicado (SPEC-0009 C3b, ADR-0007 §5). `limits.budgetUsdPerDay` y `policies.budget.perDayUsd` dejan de ser solo declarativos, para los agentes que informan su coste. Cambio aditivo en `agent-protocol`; un agente que no informa su coste sigue sin límite.

- `agent-protocol`: `AgentContext.reportCost(usd)` en los handlers del `AgentServer`; `costUsd` opcional en `RunResponse` y `TaskRecord`.
- `hermes`: `RunOutcome.costUsd`, `RunRecord.costUsd` y `RunView.costUsd`; `handler(input, signal, run)` del `InProcessConnector` con `run.reportCost`. El acumulado diario (día UTC del inicio) sale del store de runs, así que sobrevive reinicios. Nuevo error `BUDGET_EXCEEDED` al admitir un run con el presupuesto agotado (tope blando: un run en curso termina). `bk-hermes validate` reformula los avisos de presupuesto; `perRunUsd` sigue sin aplicarse.
- `hermes`: `engineRunCost(engine)` lee el coste del último run de un `AgentEngine` con `observability`, para pasarlo a `run.reportCost`.

| Paquete | Versión | |
|---|---|---|
| `agent-protocol` | 0.6.0 | `reportCost` y `costUsd` (aditivo) |
| `hermes` | 0.4.0 | presupuesto diario aplicado, `BUDGET_EXCEEDED`, `engineRunCost`; peer de `agent-protocol` ampliado a <0.7.0 |

## v0.35.0 (2026-10-26)

Defaults seguros. Tres servidores HTTP arrancaban abiertos por defecto: ahora lo seguro es el default y lo abierto hay que pedirlo. Rangos 0.x barridos: `agent-core ^0.35.0` en los paquetes que dependen de él, peers `<0.36.0` y plantillas de `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.35.0 | `secret` obligatorio en webhooks |
| `agent-protocol` | 0.5.0 | `AgentServer` en `127.0.0.1`, opción `host` |
| `agent-web` | 0.6.0 | `AgentServer` en `127.0.0.1` |
| `hermes` | 0.3.1 | solo rangos de `agent-core` y `agent-protocol` |
| `agent-coding` | 0.28.1 | solo el rango de `agent-core` |
| `agent-enterprise` | 0.8.3 | solo el rango de `agent-core` |
| `orchestrator-agent` | 0.6.2 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.2 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.12 | solo el rango de `agent-core` |
| `agent-otel` | 0.1.6 | solo el peer de `agent-core` |
| `agent-providers` | 0.3.1 | solo el peer de `agent-core` |
| `agent-sandbox` | 0.1.5 | solo el peer de `agent-core` |
| `agent-testkit` | 0.1.5 | solo el peer de `agent-core` |
| `create-bk-agent` | 0.23.3 | plantillas con los rangos nuevos |

`agent-infra`, `mcp-connectors`, `curator-codex-agent` y `agent-web-ui` no cambian.

**Orden de publicación:** core → agent-protocol → providers → hermes → coding → enterprise → orchestrator-agent → (otel, sandbox, testkit, aval-tools, web, mcp-server) → create-bk-agent.

### Cambios de comportamiento (léelos antes de actualizar)
- **`WebhookServer` / triggers `webhook` (`agent-core`): `secret` obligatorio.** Sin `secret`, cualquiera que alcance el puerto podía hacer que el agente ejecutara un prompt. `register()` y `TriggerManager.start()` ahora lanzan un error si una ruta no lo tiene. Si de verdad no quieres firma (puerto no alcanzable por terceros), declara `allowUnsigned: true` en el trigger. Arreglo normal: `{ type: 'webhook', path: '/x', secret: process.env.WEBHOOK_SECRET }`.
- **`AgentServer` (`agent-web` y `agent-protocol`): escucha en `127.0.0.1` por defecto** (antes `0.0.0.0` / todas las interfaces). Para aceptar llamadas remotas, en contenedores o detrás de un proxy en otro host: `host: '0.0.0.0'` (y configura `auth` / `apiKey`). `agent-protocol` gana la opción `host`.
- Ejemplo `marketing-co`: los agentes leen `HOST` (por defecto `127.0.0.1`); su Dockerfile fija `HOST=0.0.0.0`.

## v0.34.0 (2026-10-24)

Confianza del workspace (#99) y límites de Hermes (#100): fases C1 y C3 de [SPEC-0009](docs/specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md), con [ADR-0006](docs/adr/0006-confianza-del-workspace.md) y [ADR-0007](docs/adr/0007-un-limite-declarado-debe-aplicarse.md). Rangos 0.x barridos: `agent-core ^0.34.0` y `agent-coding ^0.28.0` en los paquetes que dependen de ellos y en las plantillas de `create-bk-agent`.

| Paquete | Versión | |
|---|---|---|
| `agent-core` | 0.34.0 | confianza del workspace, `/trust` |
| `agent-coding` | 0.28.0 | agentes de proyecto solo en proyectos confiados; necesita `agent-core >= 0.34` |
| `hermes` | 0.3.0 | `maxConcurrent` aplicado, avisos de presupuesto |
| `agent-enterprise` | 0.8.2 | solo el rango de `agent-core` |
| `orchestrator-agent` | 0.6.1 | solo el rango de `agent-core` |
| `mcp-server` | 0.18.1 | solo los rangos de `agent-core` y `agent-coding` |
| `agent-web` | 0.5.1 | solo el rango de `agent-core` |
| `aval-tools` | 0.1.11 | solo el rango de `agent-core` |
| `create-bk-agent` | 0.23.2 | plantillas con los rangos nuevos |

`agent-sandbox`, `agent-protocol`, `agent-providers`, `agent-otel`, `agent-testkit`, `curator-codex-agent` y `mcp-connectors` no cambian. Sus peers sobre `agent-core` (`<0.35.0`) ya cubren la 0.34.

**Orden de publicación (obligatorio):** core → hermes → coding → enterprise → orchestrator-agent → (aval-tools, web, mcp-server) → create-bk-agent.
`agent-coding` 0.28.0 importa `isProjectTrusted` de `agent-core`: publicarlo antes que `agent-core` 0.34.0 rompe las instalaciones. `mcp-server` depende de `agent-coding ^0.28.0`, así que va después de él.

### Cambios de comportamiento (léelos antes de actualizar)
- **`agent-core` 0.34.0 y `agent-coding` 0.28.0 — los agentes y skills de proyecto ya no cargan solos.** Lo que hay en `{proyecto}/.bk-agent/agents/` y `{proyecto}/.bk-agent/skills/` es contenido del repositorio abierto, no tuyo: un repo clonado podía traer un agente que reemplazaba al orquestador builtin con su propio prompt y herramientas. Ahora esa capa solo carga si confías en el proyecto:
  - Una vez por proyecto: `/trust add` (también `/trust status`, `remove` y `list`). Se guarda en `~/.bk-agent/trusted-projects.json`. Las skills cargan al momento; los agentes, al siguiente arranque.
  - Para CI y contenedores: `BK_TRUST_PROJECT=1`. Para un host que decide por sí mismo: `createCodingEngine({ trustedProject: true | false })`.
  - La confianza es por **ruta exacta**: confiar en `~/code` no confía en un clon dentro. Un archivo de confianza dañado significa que nadie es confiable.
  - Si el proyecto no está confiado, el engine avisa con `[Trust]` de qué se dejó fuera. Tus agentes y skills globales de `~/.bk-agent/` siguen cargando, y el mecanismo de override `.md` y la precedencia se mantienen para proyectos confiados.
  - `AgentLoader` ya no crea directorios dentro de un proyecto no confiado, y calcula el directorio global con `getFrameworkDir` como el resto del framework.
  - **No incluye** `AGENT.md`: el repositorio sigue pudiendo aportarlo al prompt (pregunta abierta nº 6 de SPEC-0009).
- **`hermes` 0.3.0 — `limits.maxConcurrent` ahora se aplica.** Antes se aceptaba y no hacía nada. Pasado el límite, una llamada nueva falla al instante con `AGENT_BUSY` (no se encola), y quien llama decide si reintenta. Cuenta runs de capabilities, no flows. Un run recuperado tras un reinicio ocupa hueco hasta que termina.
- **`hermes` 0.3.0 — presupuestos.** El presupuesto de un blueprint ya no es obligatorio cuando el creador tiene techo (declarar más que el techo sigue siendo un error). `bk-hermes validate` imprime un `warning:` en stderr por cada presupuesto declarado que nada aplica (el del agente, el del blueprint, `policies.budget`); el código de salida no cambia. **Los presupuestos siguen siendo solo declarativos**: Hermes no mide el gasto de los agentes que supervisa.

### Detalle
- **core:** módulo `trust/workspace-trust` (`isProjectTrusted`, `trustProject`, `untrustProject`, `listTrustedProjects`, `projectLayerContents`, `untrustedLayerWarning`); `SkillLoader.loadProject(cwd, trusted?)` y `loadAll(cwd, projectDir, trusted?)`; comando `/trust`; `CommandContext.workingDir`.
- **hermes:** `fleetWarnings(fleet)` y `blueprintWarnings(...)` exportados; `AGENT_BUSY` en `HermesErrorCode`. El hueco de un run se libera antes de escribir su estado final, para que quien acaba de ver `done` o `cancelled` no reciba `AGENT_BUSY`.

### Pendiente (no entra en esta versión)
SPEC-0009: C2 (el comodín `delegatesTo: ['*']`, menos urgente tras la confianza), C3b (presupuesto aplicado: exige un canal de coste en los conectores y en `agent-protocol`), C4 (el alias `model` → `provider` del frontmatter es deliberado, queda decidir si se separa) y C5 (tipo `Capability`, solo diseño). Y las decisiones de la auditoría: autenticación del HTTP de `mcp-server`, docker como default de `run_command`, `AgentServer` en `0.0.0.0`, `WebhookServer` con `secret` opcional.

## v0.33.1 (2026-10-24)

Auditoría de seguridad y robustez en cuatro lotes (#93, #94, #95, #96): 21 arreglos verificados contra el código, cada uno con sus tests. Rangos sin barrido: los parches caben en los `^` existentes; solo se actualizan los de plantillas (`orchestrator-agent ^0.6.0`), los de `create-bk-agent` (`mcp-server ^0.18.0`, `agent-web ^0.5.0`) y el peer de `hermes` sobre `agent-protocol` (`>=0.3.0 <0.5.0`).

| Paquete | Versión |
|---|---|
| `agent-core` | 0.33.1 |
| `agent-sandbox` | 0.1.4 |
| `agent-protocol` | 0.4.0 |
| `hermes` | 0.2.1 |
| `agent-coding` | 0.27.3 |
| `agent-enterprise` | 0.8.1 |
| `orchestrator-agent` | 0.6.0 |
| `curator-codex-agent` | 1.1.1 |
| `mcp-connectors` | 0.2.1 |
| `mcp-server` | 0.18.0 |
| `agent-web` | 0.5.0 |
| `create-bk-agent` | 0.23.1 |

`agent-providers`, `agent-otel`, `agent-testkit` y `aval-tools` no cambian.

**Orden de publicación (obligatorio):** core → sandbox → **agent-protocol** → **hermes** → coding → enterprise → orchestrator-agent → (curator-codex-agent, mcp-connectors, web, mcp-server) → create-bk-agent.
`hermes` 0.2.1 acepta `agent-protocol` 0.3 y 0.4 como peer; publicarlo antes que `agent-protocol` 0.4.0 no rompe nada, pero el orden evita instalaciones a medias.

### Cambios de comportamiento (léelos antes de actualizar)
- **orchestrator-agent 0.6.0:** el trigger HTTP escucha en `127.0.0.1` por defecto. Para exponerlo (un contenedor, la red) hace falta `ORCHESTRATOR_HTTP_HOST` **y** `ORCHESTRATOR_API_KEY`; un host no loopback sin clave no arranca el trigger. Los ejemplos de docker-compose de `docs/` ya lo incluyen. Además: `callLLM` tiene timeout (300 s, `ORCHESTRATOR_LLM_TIMEOUT_MS`) y la espera de subtareas vence a los 15 min (`ORCHESTRATOR_SUBTASK_TIMEOUT_MS`); dos aprobaciones solapadas del mismo gate ya no reanudan el plan dos veces (la segunda recibe 409).
- **agent-protocol 0.4.0:** `AgentClient.run()` y `runAndWait()` ya no repiten una capability tras un 5xx, un timeout o un corte (podía ejecutarse dos veces: un pago, un email). Solo reintentan un 429. `RunOptions.idempotent: true` recupera los reintentos para capabilities de solo lectura.
- **mcp-server 0.18.0:** el HTTP rechaza con 403 un `Host` u `Origin` no loopback (DNS rebinding). `resource-auth` deniega cuando ABAC no puede decidir (sin token, o `abac-service` caído); `BK_ABAC_FAIL_OPEN=1` lo permite en desarrollo. `code_index` solo acepta directorios dentro de `BK_CWD` o de `BK_INDEX_ROOTS`.
- **agent-web 0.5.0:** con un hook de auth que fija `req.user` (JwtAuth lo hace), `/sessions`, `DELETE /sessions/:id` y `/monitor` muestran a cada usuario solo sus sesiones; un token con el rol `admin` (`adminRole`) ve todas. Sin auth, nada cambia. CORS con varios orígenes devuelve el `Origin` de la petición en lugar de la lista unida.
- **mcp-connectors 0.2.1:** `fetchJson` no reintenta POST/PATCH ante un 5xx, un timeout o un corte (solo un 429). Las lecturas hechas con POST (Odoo `search`/`read`, HubSpot `/search`, Calendar `freeBusy`) lo declaran y siguen reintentando.
- **agent-core 0.33.1:** `ApprovalGate` juzga cada segmento del comando, no cómo empieza la línea: tras "approve all", instalar paquetes con `cd x && npm i y`, `sudo`, `-D`, `bash -c` o `python -m pip` vuelve a pedir aprobación. Skills y packs rechazan nombres con separadores, `:`, NUL, `.` o `..`.

### Arreglos
- **agent-coding 0.27.3:** `edit_file` ya no expande `$&`, `$1` ni `$$` en el texto nuevo (corrompía el archivo en silencio).
- **agent-core 0.33.1:** `FailureCatalog` no queda envenenado tras un fallo de escritura (perdía registros en silencio).
- **agent-sandbox 0.1.4:** `scrubEnv` también descarta variables `PAT` (`GH_PAT`, `GITHUB_PAT`) sin tocar `PATH` ni `PATHEXT`.
- **agent-enterprise 0.8.1:** `VectorStore` escribe de forma atómica; el frontmatter de `VaultWriter` escapa comillas y saltos de línea; el registro de `ComplianceGate` no puede salir de la bóveda con un `flowId` o `runId` como `../x`, y `VaultWriter` rechaza un `agentFolder` que resuelva fuera de ella.
- **orchestrator-agent 0.6.0:** `RunStore` escribe de forma atómica.
- **curator-codex-agent 1.1.1:** los adaptadores de LLM declaran su timeout (300 s, `timeoutMs`) en lugar de depender del default del SDK.

### Pendiente (decisiones de diseño, fuera de esta versión)
Autenticación del HTTP de `mcp-server` (el header `Authorization` ya es el JWT de ABAC), la allowlist de `run_command` y docker como default, `AgentServer` escuchando en `0.0.0.0`, `WebhookServer` con `secret` opcional.

## v0.33.0 (2026-10-23)

Migración a **zod 4** y a **openai 6**, y cierre de SPEC-0008 P4–P6 (control desde Hermes, aprovisionamiento, flows de otros agentes, plugins y presets). La migración cierra GHSA-mrhx-c7xc-m3w5 (`zod <4.6.6`), cuyo único parche es zod 4.6.6 (#90).

**Breaking:** los esquemas que se pasan a `defineTool` / `generateObject` deben ser de zod 4. `agent-core` ya no depende de `zod-to-json-schema` (devolvía `{}` con esquemas zod 4) y genera el JSON Schema con `z.toJSONSchema`. `agent-providers` pasa a `openai ^6`. Los proyectos que usen zod 3 junto a `agent-core` deben migrar: `z.record(x)` pasa a `z.record(z.string(), x)`, `invalid_type_error` pasa a `error` y los mensajes de error cambian (p. ej. "Invalid input: expected number").

| Paquete | Versión |
|---|---|
| `agent-core` | 0.33.0 |
| `agent-protocol` | 0.3.0 |
| `agent-providers` | 0.3.0 |
| `hermes` | 0.2.0 |
| `agent-enterprise` | 0.8.0 |
| `orchestrator-agent` | 0.5.0 |
| `curator-codex-agent` | 1.1.0 |
| `mcp-connectors` | 0.2.0 |
| `mcp-server` | 0.17.0 |
| `create-bk-agent` | 0.23.0 |
| `agent-coding` | 0.27.2 |
| `agent-sandbox` | 0.1.3 |
| `agent-otel` | 0.1.5 |
| `agent-testkit` | 0.1.4 |
| `agent-web` | 0.4.15 |
| `aval-tools` | 0.1.10 |

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (curator-codex-agent, mcp-connectors, testkit, web, mcp-server, aval-tools) → create-bk-agent.
`hermes` tiene como peers `agent-core >=0.33.0 <0.35.0` y `agent-protocol ^0.3.0`: publicarlo antes de sus peers rompe las instalaciones.

### Detalle
- **Hermes (SPEC-0008 P4–P6):** control desde Hermes (política, jobs y auditoría unificada), aprovisionamiento y carencias, flows de otros agentes (`agent-protocol`), plugins con `requires` y `grant` del operador, y presets (más el preset neutral `pipeline`).
- **zod 4:** `z.record` con clave explícita; `mcp-server` declara `zod` (antes lo usaba sin declararlo); las plantillas y `create-bk-agent` generan proyectos con `zod ^4.6.6`.
- **Seguridad:** `body-parser` 1.20.9 / 2.4.0 en el lockfile (GHSA-27r3-jxmh-p828, #91).
- **Sin verificar en vivo:** el generador de JSON Schema (`openapi-3.0`) y `openai` 6 contra un LLM real.

## v0.32.0 (2026-10-23)

Control de agentes desde fuera y primer Hermes (SPEC-0008 P1–P3; PRs #79, #81, #82, #83). Todo es aditivo y opt-in: sin `controlApiKey` el servidor se comporta como 1.0. Rangos 0.x barridos (`agent-core ^0.32.0`; peers `<0.33.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.32.0 |
| `agent-sandbox` | 0.1.2 |
| `agent-protocol` | 0.2.2 |
| `hermes` (nuevo) | 0.1.0 |
| `agent-coding` | 0.27.1 |
| `agent-enterprise` | 0.7.2 |
| `agent-providers` | 0.2.6 |
| `agent-otel` | 0.1.4 |
| `agent-testkit` | 0.1.3 |
| `agent-web` | 0.4.14 |
| `mcp-server` | 0.16.9 |
| `orchestrator-agent` | 0.4.6 |
| `aval-tools` | 0.1.9 |
| `create-bk-agent` | 0.22.11 |

`mcp-connectors` y `curator-codex-agent` no cambian.

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.2 tiene como peer `agent-core >=0.32.0 <0.33.0` (usa tipos nuevos: `PolicyControl`); `hermes` tiene como peers `agent-core >=0.31.0 <0.33.0` y `agent-protocol ^0.2.1`. Publicarlos antes de sus peers rompe las instalaciones.

### Detalle
- **core:** `createEngineControl(engine, { policy, jobs, approveWidening, onAudit })`: un handler de control con la forma de `ControlHandler` (`get/set_sandbox_policy`, `list_jobs`, `cancel_job`, `audit`). Estrechar una política es libre; ampliarla exige aprobación y falla cerrado sin aprobador (`APPROVAL_REQUIRED`); el techo del operador es un límite duro (`POLICY_WIDER_THAN_PARENT`); `expectedVersion` evita pisar cambios. `JobRegistry.listAll()` (nuevo método de la interfaz).
- **sandbox:** `isNarrowerOrEqual` / `checkNarrower` (un hijo nunca es más amplio que su padre) y `sandboxPolicyControl(policy, { ceiling })`.
- **agent-protocol:** protocolo 1.1 (compatible con 1.0): `POST /v1/agent/control`, `GET /v1/agent/runs`, `GET /v1/agent/audit`, `drain`/`resume` del servidor, `info` con `protocolMinor`, límites y flows. Cerrado por defecto: exige `controlApiKey`, distinta de `apiKey`. El cliente (`control`, `listRuns`, `audit`) no reintenta ni usa circuit breaker a propósito.
- **hermes (nuevo):** `fleet.yaml` validado (`bk-hermes validate`), registro de flota con salud periódica, conectores `in-process` y `protocol`, store de runs con reconciliación tras reinicio, herramientas `fleet_*`/`agent_*`, roles, aprobación que falla cerrado, guardrails sobre resultados y auditoría NDJSON.
- **Conocido:** cancelar un run en un `AgentServer` marca la tarea pero no aborta el handler del servidor.

## v0.31.0 (2026-10-23)

Herramientas de archivo detrás del sandbox (SPEC-0006 S3a; PR #76). Una ruta se juzga por **dónde apunta de verdad**: un symlink o junction dentro del workspace que apuntaba fuera permitía leer y escribir fuera, porque `resolveAndCheck` compara solo texto.
Es opt-in y compatible: sin `sandbox`, las herramientas se comportan como antes. Rangos 0.x barridos (`agent-core ^0.31.0`, `agent-coding ^0.27.0`; peers `<0.32.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.31.0 |
| `agent-sandbox` | 0.1.1 |
| `agent-coding` | 0.27.0 |
| `agent-enterprise` | 0.7.1 |
| `agent-providers` | 0.2.5 |
| `agent-otel` | 0.1.3 |
| `agent-testkit` | 0.1.2 |
| `agent-web` | 0.4.13 |
| `mcp-server` | 0.16.8 |
| `orchestrator-agent` | 0.4.5 |
| `aval-tools` | 0.1.8 |
| `create-bk-agent` | 0.22.10 |

`mcp-connectors` y `curator-codex-agent` no cambian: su rango `agent-enterprise ^0.7.0` cubre 0.7.1.

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.1 tiene como peer `agent-core >=0.31.0 <0.32.0` (usa tipos nuevos del contrato): publicarlo antes que core rompe las instalaciones.

### Detalle
- **core:** `SandboxRunner.authorizePath?` y tipos `SandboxPathRequest` / `SandboxPathVerdict`. El engine lo envuelve por llamada: denegaciones y escrituras permitidas salen por el transport y la auditoría de ese engine aunque el runner se comparta; las lecturas permitidas no se reportan.
- **sandbox:** `authorizePath` resuelve la ruta real (symlinks, junctions, enlaces colgantes y rutas aún inexistentes) y la compara con workspace + `roots` + directorios extra (memoria del agente). `read-only` rechaza escrituras; `danger-full-access` permite; una ruta que no se puede resolver se deniega. Exporta `realPathOf` e `isInsideDir`.
- **coding:** `write_file`, `edit_file`, `read_file`, `list_directory` y `search_files` consultan `ctx.sandbox.authorizePath` tras `resolveAndCheck`, que sigue siendo el suelo incluso en full access.

## v0.30.0 (2026-10-22)

Sandbox de ejecución (SPEC-0006 S1; PRs #73 y #74): confinamiento y permisos de lo que ejecutan los agentes, con política como datos que un plano de control puede fijar y consultar.
Es opt-in: sin `sandbox` configurado, `run_command` y el engine se comportan como antes (salvo la nota de la ruta heredada con docker). Rangos 0.x barridos (`agent-core ^0.30.0`, `agent-coding ^0.26.0`, `agent-enterprise ^0.7.0`; peers `<0.31.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.30.0 |
| `agent-sandbox` | 0.1.0 (nuevo) |
| `agent-coding` | 0.26.0 |
| `agent-enterprise` | 0.7.0 |
| `agent-providers` | 0.2.4 |
| `agent-otel` | 0.1.2 |
| `agent-testkit` | 0.1.1 |
| `agent-web` | 0.4.12 |
| `mcp-server` | 0.16.7 |
| `mcp-connectors` | 0.1.6 |
| `orchestrator-agent` | 0.4.4 |
| `aval-tools` | 0.1.7 |
| `curator-codex-agent` | 1.0.4 |
| `create-bk-agent` | 0.22.9 |

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-coding` depende **de forma dura** de `agent-sandbox` y este tiene como peer `agent-core >=0.30.0`: publicar coding antes que sandbox, o sandbox antes que core, rompe las instalaciones.
`agent-providers`, `agent-otel`, `agent-testkit`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-sandbox` (nuevo)
- **Modos** `read-only`, `workspace-write`, `danger-full-access` y red `none|allow`; presets `read-only`, `ask`, `auto-edit`, `full`.
- **Falla cerrado:** si el modo exigido no se puede imponer en este host, la llamada devuelve `SANDBOX_UNAVAILABLE` y no se ejecuta nada. El backend `none` (host) solo reclama `danger-full-access` con red abierta; `docker` reclama `read-only` y `workspace-write`.
- **Política como datos:** `SandboxPolicyConfig` JSON (preset, mode, approval, network, roots, reglas por agente/herramienta, env, writeTools, commandTools); `set()` validado que aplica a la siguiente llamada, `snapshot()`, `version`, `parsePolicyConfig()`.
- **Entorno depurado** (KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL) con `env.allow`; decisiones observables (`onDecision`) y auditoría NDJSON ordenada.
- Backend docker: workspace `:ro` y raíz de solo lectura en `read-only`, red `none` por defecto, sin capacidades, límites de memoria y procesos, **ejecución con el uid:gid del host en POSIX**.

### `@backendkit-labs/agent-core`
- Contrato `SandboxRunner` / `SandboxMode` / `SandboxOutcome` / `SandboxDecision`, `ExecutionContext.sandbox`, evento `sandbox` y `createBaseEngine({ sandbox })`; `engine.sandbox` para leer o cambiar la política en caliente.
- `authorizeTool` rechaza por nombre las herramientas de escritura en `read-only` antes del gate de aprobación; `approvalFor` sustituye la lista fija de herramientas que preguntan.
- **Fail-closed sin humano:** una herramienta que exige aprobación y no tiene `onToolApproval` se rechaza, incluso tras `disableToolApproval()`.
- Cada engine reporta solo las decisiones de sus propias llamadas aunque comparta el servicio con otros.

### `@backendkit-labs/agent-coding`
- `run_command` delega lanzamiento, terminación, timeout y captura al backend; las comprobaciones de comandos y los mensajes no cambian. `createCodingEngine({ sandbox: { preset, policy, backends, docker, auditLog } })` y `CODING_WRITE_TOOLS`.
- **Ruta heredada** (sin `sandbox`): `BK_RUN_COMMAND_SANDBOX` se traduce a la política equivalente (deprecado). Con `docker`, el contenedor corre ahora con el uid:gid del host en POSIX (antes root) y `BK_SANDBOX_NETWORK` distinto de `none` significa `bridge`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `sandbox`.

### Límites
Solo se confina lo que pasa por `ctx.sandbox.run`; una herramienta propia o MCP que lance procesos por su cuenta queda fuera. `read-only` rechaza por nombre solo las herramientas listadas como de escritura. Las herramientas de archivos siguen usando su propia comprobación de ruta hasta la siguiente entrega.

## v0.29.1 (2026-10-22)

Parche sobre la Ola 3a. Sin cambios de rangos: `^0.29.0` ya cubre 0.29.1.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.1 |
| `create-bk-agent` | 0.22.8 |

Orden de publicación: core → create-bk-agent.

- **`agent-core`:** un job cancelado (`job_kill`, `engine.abort()`) queda `cancelled` sin conservar como summary el error de su proceso muerto (antes `exit 1`) (#68).
- **`create-bk-agent`:** nuevo comando `npx create-bk-agent add testing`: instala `@backendkit-labs/agent-testkit`, jest y ts-jest como devDependencies, añade `jest.config.js`, el script `test` y un test de ejemplo sin clave de API; no sobrescribe archivos existentes (#71).
- **`agent-testkit` 0.1.0** (publicado aparte, paquete nuevo): dobles de prueba (`scriptedProvider`, `mockTransport`), servidor LLM mock compatible con OpenAI con fallos inyectables, grabación y reproducción de ejecuciones y aserciones sobre el sistema real (#69, #70).

## v0.29.0 (2026-10-22)

Ola 3a del SDK (SPEC-0002; PRs #63 a #66): herramientas con plazo y cancelación, recuperación ante desbordamiento de contexto, credenciales por referencia y jobs en segundo plano.
Todo es opt-in y aditivo salvo lo indicado. Rangos 0.x barridos (`agent-core ^0.29.0`, `agent-coding ^0.25.0`, `agent-enterprise ^0.6.0`; peers `<0.30.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.0 |
| `agent-providers` | 0.2.3 |
| `agent-coding` | 0.25.0 |
| `agent-enterprise` | 0.6.0 |
| `agent-otel` | 0.1.1 |
| `agent-web` | 0.4.11 |
| `mcp-server` | 0.16.6 |
| `mcp-connectors` | 0.1.5 |
| `orchestrator-agent` | 0.4.3 |
| `aval-tools` | 0.1.6 |
| `curator-codex-agent` | 1.0.3 |
| `create-bk-agent` | 0.22.7 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-providers`, `agent-otel`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-core`
- **Señal y plazo por herramienta:** `ExecutionContext.signal`; `timeoutMs` por herramienta y `toolTimeoutMs`/`toolTimeoutGraceMs` del engine. Al vencer o abortar, el modelo recibe `TOOL_TIMEOUT`/aborted y un resultado tardío se descarta. `tool_result` lleva `outcome` (`timeout` | `aborted`).
- **Reintento tras desbordamiento de contexto:** `isContextOverflowError`, `ContextManager.compact({ force, targetRatio })`, `noteOverflow()` y `ContextOptions.overflowRetry` (por defecto activo con `context`). Hasta 2 reintentos por ejecución; si el historial no se puede reducir se emite el error original.
- **Credenciales por referencia:** `AgentProfile.secrets` admite `{ env: "NOMBRE" }` (se resuelve en cada llamada) y `secretResolver` como respaldo; `secretLeakGuardrail` usa los valores resueltos. Los perfiles con valores literales siguen igual.
- **Jobs en segundo plano:** `createBaseEngine({ jobs })`, `JobRegistry`, herramientas `job_output`/`job_list`/`job_kill`, `ExecutionContext.jobs`, aviso de finalización al inicio de cada iteración y cancelación en `abort()`.

### `@backendkit-labs/agent-coding`
- `run_command`: respeta `ctx.signal` y mata el árbol de procesos (Windows: `taskkill /T /F`; POSIX: grupo de procesos propio); nuevo parámetro `background` cuando hay `jobs`.
- Opciones nuevas en `createCodingEngine`: `toolTimeoutMs`, `toolTimeoutGraceMs`, `jobs` (añade las herramientas `job_*` a los agentes con `run_command`) y `secretResolver`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `toolTimeoutMs`, `jobs` y `secretResolver`.

### `@backendkit-labs/agent-otel`
- Los spans `execute_tool` exponen el `outcome` de la herramienta como `bk.outcome`.

## v0.28.0 (2026-10-22)

Ola 2 del SDK: contexto por tokens con resumen, guardrails genéricos y trazas OpenTelemetry (PRs #59 y #60).
Todo es opt-in y aditivo: sin configurar `context`, `guardrails` ni un exportador de trazas el comportamiento no cambia.
Los rangos 0.x se barren (`agent-core ^0.28.0`, `agent-coding ^0.24.0`, `agent-enterprise ^0.5.0`) y los templates de `create-bk-agent` se actualizan.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.28.0 |
| `agent-providers` | 0.2.2 |
| `agent-coding` | 0.24.0 |
| `agent-enterprise` | 0.5.0 |
| `agent-otel` | 0.1.0 (nuevo) |
| `agent-web` | 0.4.10 |
| `mcp-server` | 0.16.5 |
| `mcp-connectors` | 0.1.4 |
| `orchestrator-agent` | 0.4.2 |
| `aval-tools` | 0.1.5 |
| `curator-codex-agent` | 1.0.2 |
| `create-bk-agent` | 0.22.6 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-web`, `mcp-server`, `mcp-connectors`, `aval-tools` y `curator-codex-agent` solo cambian rangos de dependencia/peer.

### Detalle

### `@backendkit-labs/agent-core` — contexto por tokens (`context`)
- Mantiene el historial bajo `context.maxTokens`: trunca resultados de tools viejos, resume los turnos más antiguos
  (el resumen nuevo extiende al anterior) y descarta como último recurso. Cortes en frontera de turno.
- Un resumidor que falla degrada a descartar con aviso; la compactación nunca detiene el run.
- El uso del resumidor se reporta como eventos `metrics` (lo ve el `CostTracker`). Estimador chars/4 calibrado con el
  `input_tokens` real del provider. Disponible también en `createCodingEngine` y `createEnterpriseSetup`.

### `@backendkit-labs/agent-core` — guardrails (`guardrails`, `guardrailOutputMode`)
- Fases `input`, `tool_call` (antes de la aprobación), `tool_result` y `output`, sobre el agente principal y todos los sub-agentes.
- Decisiones allow / redact / block, `failMode` cerrado por defecto, `dryRun`.
- Ready-made: `piiGuardrail`, `secretLeakGuardrail`, `promptInjectionGuardrail` (heurístico), `maxLengthGuardrail`,
  `denyListGuardrail`, `llmJudgeGuardrail`. Un bloqueo en `tool_call` borra los argumentos del historial.
- Salida `after` (corrige el historial; el evento trae `replacement`) o `buffer` (nada sin revisar se muestra).
- Evento `guardrail`, entradas `guardrail:<fase>:<nombre>` en `auditLog` y `MetricsSnapshot.guardrails`.
- Coding y enterprise **no** activan guardrails por defecto.

### `@backendkit-labs/agent-core` / `agent-providers` — spans de llamadas
- `llm_call` (modelo, proveedor, tokens, caché, coste, `purpose`) y `tool_call` bajo el `agent_block`, con inicio y fin reales.
- Los eventos `metrics` y `tool_result` ganan `agent_id`, `started_at` y `duration_ms` (opcionales); `metrics` también
  `provider`, `model` y `purpose`. Quien compare esos eventos con igualdad exacta debe pasar a una comparación parcial.
- `LLMProvider.modelId?` (lo implementan `OpenAICompatibleProvider` y `AnthropicProvider`).

### `@backendkit-labs/agent-otel` 0.1.0 (nuevo)
- `otlpHttpSpanExporter`: OTLP/JSON por HTTP sin SDK. `otelApiSpanExporter`: vía `@opentelemetry/api` (retiene el trace hasta
  que termina `agent.run`). Convenciones semánticas GenAI; nunca exporta prompts, respuestas ni argumentos de tools.
- Sin probar contra Jaeger/Langfuse reales. No está en `publish.yml`: publicación manual.

## v0.27.1 (2026-10-22)

Correcciones halladas probando con DeepSeek. Los rangos `^0.27.0`, `^0.2.0` y `^0.23.0` ya cubren estas versiones: sin barrido ni cambio en `create-bk-agent`.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.1 |
| `agent-providers` | 0.2.1 |
| `agent-coding` | 0.23.1 |

### Detalle

### `@backendkit-labs/agent-core` / `agent-providers` / `agent-coding` — correcciones halladas probando con DeepSeek

- **`metrics` lleva `cost_usd`.** El `ObservabilityManager` calculaba el costo pero el evento que llegaba
  al transporte seguía sin él, así que ninguna interfaz podía mostrarlo. Ahora, con un `costTracker` con
  precios, el evento `metrics` reenviado incluye el `cost_usd` de esa llamada (tokens de caché incluidos).
  Un `cost_usd` que ya traiga el provider se respeta, y sin precios el evento no cambia.
- **DeepSeek V4 y `toolChoice` forzado.** V4 piensa por defecto y responde 400 a un `toolChoice`
  `'required'` o por nombre en ese modo. `DeepSeekProvider` envía ahora `thinking: disabled` en esas
  llamadas (si no fijaste `thinking` tú). Opción nueva `disableThinkingForForcedTools` en
  `OpenAICompatibleProvider` (apagada por defecto: no todos los endpoints aceptan el campo `thinking`;
  encendida en el preset de DeepSeek y para el provider `deepseek` de `createCodingEngine`).

### `examples/` — refactor con las novedades de 0.27

Los ejemplos dependen ahora de los paquetes **publicados** (`agent-core ^0.27.0`, `agent-coding ^0.23.0`,
`agent-providers ^0.2.0`…) en vez de rutas `file:` que ya no resolvían dentro del monorepo.
- `git-agent`: `createBaseEngine` + `agent-providers` (se borra su copia del provider y la dependencia
  `openai`); presupuesto por ejecución con `abortOnBudget`; modo solo lectura (`GIT_AGENT_READONLY=1`);
  `/report` con salida estructurada (`engine.generateObject`); la terminal muestra uso, avisos del
  framework y tope de presupuesto; `npm run smoke` (prueba real contra un repo temporal).
  Sus herramientas git ya no pasan por un shell: usan `execFile` con argumentos (nada de lo que elija el
  modelo se interpreta como sintaxis de shell), rechazan refs que empiezan por `-`, no se cuelgan pidiendo
  credenciales y devuelven también lo que git imprime por stderr (checkout, merge, push). `npm run check`
  las prueba sin LLM.
- `vault-pilot`: su `DeepSeekProvider` pasa a ser un adaptador fino sobre `agent-providers`.
- `code-explainer` y `git-analyst`: tope de gasto opcional por llamada (`AGENT_BUDGET_USD` + precios).
- `coding-assistant`: tope de gasto opcional, `maxParallelTools: 4`, muestra uso de caché y tope de
  presupuesto; corrige tipos desfasados (`IterationMode`, `mcpAdd`) que ya no compilaban contra core.
- Sin cambios (no usan un motor de agentes): `pg-dev-server`, `marketing-co`, `workflow.mcp-agents`.
  `finance-managment` (NestJS con motor propio) queda fuera de este cambio.

## v0.27.0 (2026-10-21)

Cierra la Ola 1 del SPEC-0001: salida estructurada (ADR-0003) y caché de prompt y razonamiento de
Anthropic (ADR-0004).

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.0 |
| `agent-providers` | 0.2.0 |
| `agent-coding` | 0.23.0 |
| `orchestrator-agent` | 0.4.1 |
| `agent-enterprise` | 0.4.3 |
| `agent-web` | 0.4.9 |
| `mcp-server` | 0.16.4 |
| `aval-tools` | 0.1.4 |
| `create-bk-agent` | 0.22.5 |

`agent-providers` 0.2.0 requiere `agent-core` `>=0.27.0 <0.29.0`. `orchestrator-agent`,
`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` / `agent-coding` / `agent-providers`; los templates pasan a `agent-core ^0.27.0` y
`agent-coding ^0.23.0`. `maxParallelTools` sigue en 1 por defecto.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — salida estructurada (ADR-0003)

`generateObject(provider, prompt, zodSchema, opts?)` (nuevo, en `agent-core`) pide al modelo un
objeto que cumpla el esquema, lo valida con zod y lo devuelve tipado. Una respuesta inválida se
reintenta **una vez** diciéndole al modelo qué estaba mal; si vuelve a fallar lanza
`StructuredOutputError` (con `raw` e `issues`). Los fallos del provider se relanzan tal cual.
`engine.generateObject(prompt, schema, { agentId?, retries? })` usa el provider del agente y emite
el uso de tokens como eventos `metrics` (sin tocar el historial). También `generateObjectWith`
para clientes que no son un `LLMProvider`, y `zodToParameters` (el helper de esquemas que usaba
`defineTool`, ahora exportado).

Contrato (compatible hacia atrás, todo opcional): `LLMProvider.chat(..., options?: ChatOptions)`
con `responseFormat` y `toolChoice`, y `LLMProvider.capabilities.structuredOutput`
(`'native' | 'json_object' | 'none'`). Un provider que no conoce `options` sigue funcionando: la
validación zod siempre se aplica, y si el provider no impone el esquema éste se añade al prompt.

Mapeo por provider:
- `OpenAICompatibleProvider`: `response_format: json_schema` (`structuredOutput: 'native'`, por
  defecto). El modo estricto se relaja solo si el esquema tiene campos opcionales u objetos que
  admiten propiedades extra (OpenAI respondería 400). `toolChoice` se traduce a `tool_choice`.
- `DeepSeekProvider` y `OllamaProvider`: `json_object` (el esquema viaja en el prompt). Ollama
  admite `structuredOutput: 'native'` si tu servidor soporta `json_schema`.
- `AnthropicProvider`: `output_config.format` con el esquema (`structuredOutput: 'native'`) o, como
  respaldo explícito, una herramienta `respond` forzada (`structuredOutput: 'tool'`; no se puede
  combinar con `thinking`). `toolChoice` se traduce a `tool_choice`.
- `createCodingEngine`: el provider `deepseek` usa `json_object` por defecto (no admite
  `json_schema`); `structuredOutput` es configurable en cada provider.

`intent-detector` deja de extraer la acción con una regex: usa `generateObjectWith` con un enum de
acciones. Una respuesta no válida sigue acabando en `unknown`. `LLMChatClient.chat` y
`adaptProviderToLLMClient` propagan las opciones. El planner de `orchestrator-agent` y los curadores
migran a `generateObject` en cambios posteriores.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — caché de prompt y razonamiento extendido de Anthropic (ADR-0004)

`AnthropicProvider` (y `AnthropicConfig` de `createCodingEngine`) gana, todo opt-in:
- `cache: 'none' | 'system' | 'system+tools' | 'auto'` (default `'none'`: la petición es idéntica a
  la anterior) y `cacheTtl: '5m' | '1h'`. Con caché, el system prompt se envía como bloques con
  `cache_control` en el último; `system+tools` marca también la última herramienta y `auto` añade
  un punto móvil en el último mensaje (útil en bucles de herramientas).
- `thinking: { budgetTokens }` (entero >= 1024 y < `maxTokens`; si no, error claro al crear el
  provider). Con thinking se omite `temperature`. Los bloques `thinking`/`redacted_thinking` con su
  firma se guardan en `LLMMessage.raw` y se reenvían intactos en el turno siguiente.

Contrato de `agent-core`:
- `LLMMessage.raw?: unknown` (payload opaco del provider; `HistoryManager` lo persiste).
  `OpenAICompatibleProvider` lo descarta al enviar.
- `LLMStreamCallbacks.onMetrics(input, output, usage?)` con `usage = { cacheReadTokens, cacheWriteTokens }`,
  y `onReasoning?(delta)`. El evento `metrics` gana `cache_read_tokens` y `cache_write_tokens`
  opcionales (visibles en la terminal de `coding`).
- `CostTracker` suma lectura y escritura de caché con `cacheReadPricePerMToken` /
  `cacheWritePricePerMToken` (por defecto 0,1x y 1,25x del precio de entrada; con TTL de 1 hora
  la escritura cuesta ~2x: configúralo). `MODEL_PRICING` incluye esos precios para los modelos
  Anthropic que ya listaba, **calculados con los multiplicadores y no contrastados con la tarifa
  vigente**: revísalos antes de confiar en el costo.

No se emite evento de razonamiento al transporte en esta ola (queda `onReasoning`).

## v0.26.0 (2026-10-21)

| Paquete | Versión |
|---|---|
| `agent-core` | 0.26.0 |
| `agent-providers` | 0.1.0 (nuevo) |
| `agent-coding` | 0.22.0 |
| `orchestrator-agent` | 0.4.0 |
| `agent-enterprise` | 0.4.2 |
| `agent-web` | 0.4.8 |
| `mcp-server` | 0.16.3 |
| `aval-tools` | 0.1.3 |
| `create-bk-agent` | 0.22.4 |

`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` (y los templates de `create-bk-agent` pasan a `agent-core ^0.26.0`, `agent-coding
^0.22.0`, `orchestrator-agent ^0.4.0`).

### `@backendkit-labs/agent-providers` 0.1.0 (nuevo) — una sola implementación de providers (ADR-0005)

Paquete nuevo con `BaseStreamingProvider`, `OpenAICompatibleProvider`, `AnthropicProvider` y los
presets `OllamaProvider` y `DeepSeekProvider`. `agent-coding` los re-exporta con los mismos
nombres y `orchestrator-agent` los consume (su `provider.ts` queda como adaptador de la config
snake_case). Reintentos con `@backendkit-labs/retry`: 429, 5xx y errores de red; nunca tras
emitir contenido ni tras un aborto. Cliente SDK inyectable (`client`) y primera suite de pruebas
de providers.

Cambios de comportamiento a tener en cuenta:
- `maxAttempts` explícito; `maxRetries` queda como alias obsoleto con el mismo significado de
  antes (intentos totales; en Ollama cuenta reintentos, 2 = 3 intentos).
- **Ollama:** ahora pide `include_usage` (antes no reportaba tokens, así que el presupuesto no
  veía sus llamadas) y también reintenta 429.
- **DeepSeek:** `maxRetries` ya no se descarta.
- **orchestrator-agent:** ahora respeta `model` y `signal` (se puede abortar); sigue sin enviar
  `max_tokens` y conserva temperatura 1 para modelos "reasoner".
- `createCodingEngine`: `OpenAICompatibleConfig` expone `thinking`.
- `agent-coding` ya no depende de `openai` ni de `@anthropic-ai/sdk` (los trae `agent-providers`).
- `agent-providers` declara `agent-core` como peer (`>=0.25.0 <0.27.0`); `orchestrator-agent`
  sube su rango de `agent-core` a `^0.25.0`.

Pendiente de este ADR: bump y publicación (providers → coding → orchestrator-agent) y actualizar
los templates cuando `agent-providers` esté en npm.

### `@backendkit-labs/agent-core` 0.26.0 / `@backendkit-labs/agent-coding` 0.22.0 — aborto automático por presupuesto (ADR-0002)

`abortOnBudget` (default `false`) en `createBaseEngine` y `createCodingEngine`; este último expone
además `observability`. Con él, al superar `costTracker.budget` el motor llama a `engine.abort()`,
emite el evento nuevo `budget_exceeded` (con `BudgetUsage`) y luego invoca tu `onBudgetExceeded`.
La llamada que cruza el límite termina (y se paga), pero su respuesta se descarta. Los
sub-agentes (`ask_agent`) también se detienen. Si hay `budget` sin precios, o con `perDay`, el
motor emite un aviso `system` de nivel `warn` al crearse (el gasto diario no se persiste).

**Cambio de comportamiento:** `onBudgetExceeded` se disparaba en cada evento de métricas
una vez superado el límite, y el límite diario quedaba oculto si el de ejecución también se
superaba. Ahora se dispara **una vez por límite y por ejecución** (`perDay`: una vez por día) y se
reportan ambos si se superan a la vez. El costo que entrega el provider (`cost_usd`) ahora se
acumula entre llamadas en `getRunCost()` / `getDayCost()`. `AgentEvent` gana `budget_exceeded`:
revisa los `switch` exhaustivos propios.

## v0.25.0 (2026-10-21)

### `@backendkit-labs/agent-core` 0.25.0 / `@backendkit-labs/agent-coding` 0.21.0 — ejecución paralela de tool calls (ADR-0001)

`ToolDefinition.concurrencySafe` (opt-in, default `false`) y `maxParallelTools` en `AgentEngine`,
`createBaseEngine` y `createCodingEngine` (default `1`: comportamiento idéntico al anterior).
Con `maxParallelTools > 1`, las tools seguras consecutivas de un turno corren en paralelo; una
tool no segura es una barrera. Resultados y eventos conservan el orden de las llamadas y
`onToolApproval` se invoca en serie. Marcadas seguras: `read_file`, `list_directory`,
`search_files`, `list_audits`, `get_latest_audit`, `memory_recall`, `memory_search_knowledge`.
Tools MCP: solo con `MCPServerConfig.trustAnnotations: true` y `readOnlyHint`.

### `@backendkit-labs/agent-core` — `createBaseEngine` reenvía los callbacks de aprobación e iteración (corrección)

`createBaseEngine` no declaraba ni reenviaba `onToolApproval`, `onIterationLimit`, `onStep` ni
`iterationMode` a `AgentEngine`. `createCodingEngine` los pasa con `spread` condicional, que
TypeScript no revisa por propiedades sobrantes, así que se descartaban en silencio: **la
aprobación de herramientas de escritura nunca se activaba** (un callback que devolvía `'reject'`
no impedía que `write_file` se ejecutara) y los callbacks de iteración no se llamaban.

Ahora `BaseEngineOptions` declara los cuatro y se pasan al motor. Quien use `createCodingEngine`
con `onToolApproval` empezará a ver las confirmaciones que antes no aparecían. Detalle en
`docs/specs/SPEC-0001-agent-core-ola-1.md` §2.

## v0.24.0 (2026-08-07)

### `@backendkit-labs/agent-core` — credenciales por agente

`AgentProfile.secrets` (nuevo, opcional): credenciales propias del agente, inyectadas en
`ExecutionContext.secrets` en cada llamada a herramienta. Antes de esto, una herramienta que
necesitara una clave externa sólo podía leerla de una variable de entorno compartida por todo
el proceso — cualquier agente con esa herramienta tenía la misma clave que todos los demás. Con
`secrets`, la clave vive en el perfil de cada agente y una herramienta la lee de `ctx.secrets`,
no del entorno.

Cambio aditivo: campo opcional en `AgentProfile` y en `ExecutionContext`, propagado en
`buildContext()` con el mismo patrón condicional que ya usa `blockedCommands`. No afecta a
ningún agente existente que no lo declare.

```typescript
const profile: AgentProfile = {
    // ...
    allowedTools: ['pay', 'check_payment'],
    secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
};
```

### `@backendkit-labs/aval-tools` (paquete nuevo)

Herramientas `pay` y `check_payment` para que un agente gaste dinero a través de una instancia
de [AVAL](https://github.com/BackendKit-labs/aval) — presupuesto previo, decisión antes del
gasto, registro encadenado. `pay` pide un techo de gasto y devuelve el resultado como texto
(pagado, retenido o denegado); `check_payment` consulta el estado de un gasto retenido en una
invocación posterior, sin que la sesión del agente tenga que quedarse esperando a que una
persona lo apruebe.

Usa `secrets` de arriba para la credencial: cada agente lleva su propia clave de AVAL, nunca
una compartida.

## v0.23.0 (2026-06-11)

### `@backendkit-labs/agent-web` — `MonitorBus`

Nuevo subsistema de observabilidad en tiempo real sobre todas las sesiones activas del servidor.

#### `MonitorBus`

Fan-out de eventos a observadores WebSocket read-only. Un servidor puede tener N monitores conectados simultáneamente sin impacto en las sesiones de chat.

```typescript
import { MonitorBus } from '@backendkit-labs/agent-web';
```

**Protocolo (server → monitor):**

```typescript
// Al conectar: lista de sesiones ya abiertas
{ type: 'monitor_hello', sessionIds: string[] }

// Ciclo de vida de sesiones
{ type: 'monitor_session_open',  sessionId: string }
{ type: 'monitor_session_close', sessionId: string }

// Input del usuario (antes de que el engine procese)
{ sessionId: string, type: 'run_input', content: string }

// Todos los AgentEvents de esa sesión
{ sessionId: string, type: 'token' | 'tool_call' | 'done' | ... }
```

El `MonitorBus` se crea automáticamente en `AgentServer` y se conecta al `SessionManager`. No requiere configuración adicional.

**Endpoint:** `WS /monitor` — read-only, no acepta input del cliente.

**`/health`** ahora incluye `monitors: number` — cantidad de observadores conectados.

---

### `@backendkit-labs/agent-web-ui` — template `kanban`

Template de monitoreo enterprise: visualiza la actividad de todos los agentes en tiempo real como un tablero kanban.

#### Layout

Secciones apiladas verticalmente. Cada sección es una columna del flujo:

```
┌─────────────────────────────────────────────┐
│ ● PENDIENTE  (n)                             │
│  [Card: mensaje del usuario]                 │
├─────────────────────────────────────────────┤
│ ● EN PROCESO  (n)                            │
│  [Card: agente trabajando + tool badges]     │
├─────────────────────────────────────────────┤
│ ● ESPERANDO APROBACIÓN  (n)                  │
├─────────────────────────────────────────────┤
│ ● COMPLETADO  (n)                            │
│  [Card: finalizado + tiempo + tokens]        │
└─────────────────────────────────────────────┘
```

#### Mapeo de eventos → columnas

| Evento | Transición |
|---|---|
| `run_input` | Nueva card en **Pendiente** |
| `block_start` | → **En Proceso** (actualiza agente activo) |
| `tool_call` | Badge animado (spinner) sobre la card activa |
| `tool_result` | Badge → verde (ok) / rojo (error) |
| `done` / `ready` | → **Completado** |
| `error` | → **Completado** (sección roja) |
| `monitor_session_close` con run activo | → **Completado** (error: desconexión) |

#### `useKanbanMonitor` hook

```typescript
const { runs, status, activeSessions, connect, disconnect, clearDone } =
  useKanbanMonitor({ url: 'ws://localhost:3000/monitor' });
```

`runs: KanbanRun[]` — historial completo de runs. Cada run tiene `sessionId`, `title` (primeros 80 chars del input), `column`, `agentId/Name/Icon`, `toolCalls[]`, `tokens`, `startedAt`, `completedAt`.

#### Navegación integrada

`NavTabs` — tabs **Chat / Monitor** en el header de ambos templates. Hash router sin dependencias externas:

- `http://localhost:5173/` → Chat
- `http://localhost:5173/#kanban` → Monitor

---

## v0.22.0 (2026-06-10)

### `@backendkit-labs/agent-web` 0.1.0 — nuevo paquete

Capa HTTP/WebSocket que envuelve `AgentEngine` y lo expone al browser.

#### `WebSocketTransport`

Implementa la interfaz `Transport` de `agent-core` sobre un WebSocket de `@fastify/websocket`. Traduce `AgentEvent` a frames JSON. Maneja reconexiones y cierre limpio.

```typescript
// El engine recibe un WebSocketTransport en lugar de CallbackTransport
const transport = new WebSocketTransport(socket);
const engine = new AgentEngine({ transport, ... });
```

#### `SessionManager`

Gestiona N sesiones concurrentes. Una `AgentEngine` instance por sesión. Sweep automático de sesiones idle (default: 30 min). Límite configurable de sesiones simultáneas (default: 100).

#### `AgentServer`

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({
    port: 3000,
    engineFactory: (sessionId, transport) => new AgentEngine({ transport, ... }),
    auth: async (req, reply) => { /* JWT / API key / OIDC — hook pluggable */ },
    cors: '*',
    maxSessions: 100,
    maxIdleMs: 30 * 60 * 1000,
});

await server.start();
```

**Rutas:**

| Ruta | Descripción |
|---|---|
| `WS /chat` | Conectar sesión. Enviar `{ type: 'input', content }` / `{ type: 'abort' }` |
| `GET /health` | Estado del servidor y número de sesiones activas |
| `GET /sessions` | Lista de sesiones con timestamps |
| `DELETE /sessions/:id` | Cerrar sesión específica |

**Protocolo WebSocket (client → server):**

```json
{ "type": "input",  "content": "¿Cuál es la política de vacaciones?" }
{ "type": "abort" }
```

El servidor devuelve `AgentEvent` JSON frames: `token`, `tool_call`, `tool_result`, `agent_switch`, `done`, `error`, etc. — mismos eventos que `CallbackTransport`.

**Cliente HTML de prueba:** `client/index.html` — chat funcional vanilla JS, sin dependencias, sirve como referencia de implementación del protocolo.

---

### `@backendkit-labs/agent-web-ui` 0.1.0 — nuevo paquete

Template React para el template `chat` del scaffold enterprise.

**Stack:** React 18 + Vite + Tailwind CSS v4 + shadcn/ui + TypeScript

#### `useAgentSession` hook

```typescript
const {
    messages,      // ChatMessage[] — historial completo
    status,        // 'disconnected' | 'connecting' | 'connected'
    isRunning,     // true mientras el engine procesa
    activeAgent,   // { id, name, icon } del agente activo
    connect,
    disconnect,
    sendMessage,
    abort,
    clearMessages,
} = useAgentSession({ url: 'ws://localhost:3000/chat' });
```

Maneja el estado completo del stream: acumula tokens en el mensaje activo, actualiza badges de tool calls en tiempo real, detecta cambios de agente.

#### Componentes

| Componente | Descripción |
|---|---|
| `ChatWindow` | Área de scroll con auto-scroll al último mensaje |
| `MessageBubble` | Burbujas user/assistant con Markdown renderizado, cursor de streaming |
| `ToolCallBadge` | Badge animado: spinner → verde (ok) / rojo (error) |
| `InputBar` | Textarea auto-resize, Enter para enviar, botón Stop durante streaming |

#### `App.tsx` — template chat completo

- Header con badge del agente activo y estado de conexión
- Barra de URL colapsable para cambiar el servidor sin recompilar
- Dark theme por defecto (variables CSS de shadcn)
- `VITE_AGENT_SERVER_URL` env var para configurar el servidor en build

---

### Pilot enterprise — web server

`pilot/src/web-server.ts` — servidor de prueba que conecta el pilot vault con el browser:

```bash
PORT=4001 npm run web   # desde /pilot
# → abre http://localhost:5173 (Vite dev server)
```

Validado end-to-end: browser conecta por WebSocket, agente busca en vault con RAG, responde en streaming token a token, badges de tool call se animan en vivo.

---

## v0.21.0 (2026-06-10)

### `@backendkit-labs/agent-core` 0.20.2 → 0.21.0

#### Engine decomposition — god object eliminado

`AgentEngine` pasó de ~1350 a ~895 líneas. Cuatro módulos extraídos con responsabilidad única:

| Módulo | Responsabilidad |
|---|---|
| `HistoryManager` | Historial de mensajes: push, save, load, sanitize, trim |
| `AuditLogger` | Escritura de registros de auditoría en disco |
| `MCPRegistrar` | Estado MCP, init, registro de agentes/tools/triggers, routing |
| `ApprovalGate` | Decisión de aprobación de tool calls (3 branches → `check()`) |

#### Tests — red de integración del core

10 escenarios de integración nuevos sobre `AgentEngine` + `DelegationBus`:

| Test | Qué valida |
|---|---|
| `abort()` a mitad de ejecución | `sanitizeMessages` elimina chain incompleto; no hay 400 en el siguiente `run()` |
| 3 `ask_agent` en paralelo | `runParallel` ejecuta concurrente; resultados mapeados al `tool_call_id` correcto |
| Delegación anidada | `depth > 0` bypasea el bulkhead; no hay starvation con 6 slots |
| Dos `run()` concurrentes | Mutex serializa; historial no se corrompe |
| Historial con chain partido cargado de disco | Save + load round-trip produce historial válido |
| `toolTriggers` MCP sin permiso | Auth + approval aplican igual que para tools directas |
| Tool rechazada por `onToolApproval` | Mensajes de error correctos; audit con `success: false` |
| `maxIterations` en sub-agentes | Config respetada (no hardcoded 30) |
| Eventos paralelos por agente | Cada bloque `block_start…block_end` es contiguo por `agent_id` |
| `loadAgents` concurrente | Promise cache: una sola carga; ambos callers esperan |

Suite total: **294 tests** (293 en rama `refactor/engine-quality` + 1 fix post-merge).

#### QA flow — cobertura

`QAService` y `qa-orchestrator` ahora cubiertos:
- `countCodeLines`: 5 tests
- `evaluateReview`: 10 tests (todos los paths + patrones específicos + tiebreaker)
- `extractFindings`: 7 tests (bullet, numerado, severidades, fallback)
- `activateQaEngineerIfNeeded`: 7 tests
- `processQaEngineerResponse`: 6 tests

Fix: `'issues found'` eliminado de `REJECTION_PATTERNS` — era substring de `'no issues found'` y causaba falso positivo.

#### Fase 3 — strings al LLM unificados en inglés

Cero español en strings que entran al contexto del LLM:
- `AgentEngine`: headers de orquestación traducidos
- `qa-orchestrator`: prompt de activación del QA engineer traducido
- `QAService`: `APPROVAL_PATTERNS` / `REJECTION_PATTERNS` reorganizados (inglés primero, español como fallback para respuestas mixtas); system prompts, mensajes de usuario y headers de secciones traducidos
- `LessonsMemoGenerator`: headers de documento, secciones, tabla, checklist y todas las recomendaciones por `failureType` traducidos

#### Fase 4 — clasificación de subsistemas

Matriz de estado publicada en el README raíz. Tres niveles:

| Estado | Significado |
|---|---|
| **core** | Requerido para la historia enterprise — revisión completa ante cambios |
| **stable** | Funciona y se mantiene; no se expande durante el piloto |
| **experimental** | Congelado — `qa`, `reflection`, `agent-memory`, `observability`, `triggers` |

Regla durante el piloto: sin features nuevas en subsistemas `experimental`.

---

### `@backendkit-labs/agent-enterprise` 0.2.0 → 0.3.0

#### Nuevo export: `SimpleEmbedder`

```ts
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
```

TF-IDF con feature hashing (256 dims, djb2), sin dependencias externas, sin Ollama.
Ideal para desarrollo, CI y pilotos donde no hay GPU disponible.
Para producción usar `OllamaEmbedder` con `nomic-embed-text`.

---

### Pilot enterprise (`pilot/`) — no publicado

REPL interactivo que valida la historia enterprise de punta a punta:
- Vault compartido como fuente única de verdad (`pilot/vault/`)
- 6 notas seed: decisiones de arquitectura, patrones, lecciones, guía de arranque
- `npm run repl` — conversación libre con agente consultant + analyst
- `npm run smoke` — verifica indexado RAG + búsqueda + llamada LLM end-to-end
- `dotenv` — carga `.env` automáticamente al arrancar
- `SimpleEmbedder` — sin Ollama requerido para el piloto

Ciclo validado: humano documenta → LLM busca via RAG → agente responde con contexto real del negocio → agente escribe de vuelta → conocimiento disponible en el próximo turno.

---

### Docs

- `proyecto-agentes-web.md`: Principio rector 2 — vault como fuente única de verdad; §2.1 con diagrama del ciclo de aprendizaje colectivo y tabla agente genérico vs enterprise
- READMEs de paquetes: status header en `core`, `enterprise`, `coding`, `mcp-server`, `create-bk-agent`

---

## v0.15.0 (2026-06-04)

### Breaking changes — package rename

All packages now use the `@backendkit-labs` npm scope:

| Old | New |
|-----|-----|
| `@bk/agent-core` | `@backendkit-labs/agent-core` |
| `@bk/agent-coding` | `@backendkit-labs/agent-coding` |
| `@bk/mcp-server` | `@backendkit-labs/mcp-server` |

Migration:

```bash
npm uninstall @bk/agent-core @bk/agent-coding @bk/mcp-server
npm install @backendkit-labs/agent-core @backendkit-labs/agent-coding
```

Replace all imports:

```ts
// Before
import { ... } from '@bk/agent-core';
// After
import { ... } from '@backendkit-labs/agent-core';
```

### New

- `create-bk-agent` — interactive CLI scaffolder (`npx create-bk-agent my-project`)
- 5 starter templates: `coding`, `domain-agent`, `autonomous`, `mcp-server`, `minimal`
- `AgentEngine.updateWorkingDir(newCwd)` — live workspace switch without engine restart
- `/skills create` — scaffold a new skill file locally
- `/skills generate` — LLM-generate a skill from a description
- `/skills reload` — hot-reload skills without restarting
- `/skills uninstall` and `/skills update` — full skill lifecycle management
- `AgentEngine.callLLM(prompt)` — direct single-turn LLM call for slash commands

### Fixed

- `advanceRequiredGates`: only advances gates the task actually requires
- QA gate no longer records a false GO when no qa-engineer agent exists
- Policy engine used `architecture-agent`/`security-agent` IDs that did not match registered profiles — corrected to `architecture`/`security`
- `hasPassedGate`: replaced linear index comparison with FSM-semantics checks
- `computeKeywordScores`: capped at 15 to match confidence normalization denominator
- Workspace `add-app` now syncs `settings.cwd` when the new project becomes active

---

## v0.14.0 (2026-05-30)

- Skills hot-reload: `AgentEngine.reloadSkills()` resets YAML layer on next `run()`
- Orchestration: respect `requiresX` flags in gate advancement
- `matchesKeyword` deduplicated into `orchestration/keyword-match.ts`
- `AgentEngine.callLLM()` for raw single-turn LLM access from slash commands
- QA gate never auto-GO without a real reviewer