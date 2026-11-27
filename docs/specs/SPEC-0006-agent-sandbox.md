# SPEC-0006: agent-sandbox — confinamiento y permisos de ejecución

**Fecha:** 2026-10-22
**Estado:** Parcial: S1 (sandbox de ejecución, PR #73 y #74, v0.30.0) y S3a (herramientas de archivo detrás del sandbox, PR #76, v0.31.0) publicadas en `agent-sandbox`. El resto de fases, sin revisar contra el código. *(Revisado el 2026-11-18; antes decía: Borrador)*
**Inspiración:** `sandbox/*`, `interaction/permission-presets`, `interaction/user-approval`, `fs/fs-sandbox`, `docs/defensive-patterns.md` de deepseek-harness (diseño, no código).
**Cierra:** el pendiente de la auditoría "sandbox de `run_command` (decidir docker)".

## 1. Estado verificado
Hoy hay piezas sueltas en `agent-coding`: `COMMAND_ALLOWLIST` fijo en `run-command.ts`; `blockedCommands` por agente; `path-sandbox.resolveAndCheck` (raíces permitidas); `secret-scanner` (solo avisa); **sandbox docker opt-in** (`BK_RUN_COMMAND_SANDBOX=docker`: falla cerrado, `--network none`, `--cap-drop ALL`, `no-new-privileges`, memoria 2 GB, 512 pids, workspace montado); `ApprovalGate` solo en modo manual para `write_file`/`edit_file`/`run_command`. Falta una política única: el docker solo cubre `run_command`; el terminal y las herramientas de archivos aplican otras reglas; no hay niveles ni elevación.

## 2. Objetivos y no objetivos
### Objetivos
1. Tres modos de confinamiento por llamada: `read-only`, `workspace-write`, `danger-full-access`.
2. **Fail-closed:** si el modo pedido no puede imponerse en este host, la llamada falla con `SANDBOX_UNAVAILABLE`; nunca se ejecuta sin confinar en silencio.
3. Un solo punto de política para shell, herramientas de archivos y terminales; elegible por sesión.
   *Estado (2026-10-23):* shell (`run_command`) y herramientas de archivo ya pasan por el servicio (S1, S3a: la ruta se juzga por dónde apunta de verdad, symlinks incluidos). **Terminal interactiva: fuera de alcance** — no existe en el repo y no hace falta para controlar flujos; si algún día se necesita pasar respuestas a un programa, se añade `stdin` a `run_command` en vez de una sesión pty. Si se construyera una terminal, nacería contra `ctx.sandbox`.
4. Backends intercambiables: `docker` (existente), `bwrap`/`landlock` (Linux), **Windows** (token restringido o Job Object + ACL), `ssh` (remoto).
5. Presets de permisos que combinan sandbox + aprobación (`read-only`, `ask`, `auto-edit`, `full`).
6. Elevación: tras una denegación el modelo puede pedir un modo estrictamente más amplio con aprobación humana.
7. Higiene de subprocesos (de `defensive-patterns`): entorno depurado, temporales privados, teardown hasta quiescencia.
### No objetivos
Aislamiento de kernel completo (para eso, contenedor/microVM/ejecutor remoto); gestión de imágenes.

## 3. Diseño
```ts
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export interface SandboxBackend {
    readonly name: string;
    supports(mode: SandboxMode): boolean;
    exec(req: { argv: string[] | string; cwd: string; env: Record<string,string>; mode: SandboxMode; roots: string[]; network: 'none'|'allow'; timeoutMs?: number; signal: AbortSignal }): Promise<ExecResult>;
}
export interface SandboxPolicy { resolve(ctx: { sessionId: string; agentId: string; tool: string }): { mode: SandboxMode; roots: string[]; network: 'none'|'allow' } }
```
`SandboxService.run(ctx, req)` consulta la política, elige el primer backend que soporte el modo y, si ninguno, devuelve `SANDBOX_UNAVAILABLE`. Las herramientas (`run_command`, terminal, escrituras de archivo) dejan de decidir por su cuenta y llaman al servicio. `path-sandbox` pasa a ser la validación de raíces del propio servicio.

### 3.1 Backends
- **docker** (existente): se refactoriza detrás de la interfaz; `read-only` monta el workspace `:ro`; `workspace-write` con escritura solo en el workspace; red `none` por defecto.
- **windows**: investigación de bajo riesgo primero (Job Object con límites y proceso hijo con token restringido); la variante ACL con SID de capacidad es la más fuerte pero requiere código nativo; decisión en §6.
- **bwrap/landlock** (Linux) y **ssh**: fases posteriores.
- **none**: solo permitido para `danger-full-access`.

### 3.2 Presets (`PermissionPresets`)
| Preset | Sandbox | Aprobación |
|---|---|---|
| `read-only` | `read-only` | nunca necesaria (nada escribe) |
| `ask` | `workspace-write` | preguntar en escrituras y comandos |
| `auto-edit` | `workspace-write` | preguntar solo por comandos fuera de lista |
| `full` | `danger-full-access` | ninguna |
Por sesión; una combinación que no coincide se muestra como `custom`. Se persiste con la sesión (SPEC-0004).

### 3.3 Elevación y aprobación
Tras `SANDBOX_DENIED`, el modelo puede llamar a `request_escalation({ mode, reason })`; la aprobación humana (o política de máquina) la concede **solo para esa llamada**. Cada solicitud y resultado queda en `auditLog`. Aprobador ausente o con error → `unavailable` (cierra).

### 3.3.1 Aprobador de máquina
El aprobador de una escalación puede ser humano o una **política de máquina** (por ejemplo, Hermes aplicando la política de la empresa, SPEC-0003 §5). El contrato es el mismo: concede solo para esa llamada, queda en `auditLog` con quién aprobó y por qué regla, y sin aprobador aplicable o con error cierra.

### 3.4 Higiene de subprocesos
Entorno depurado (se eliminan variables `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*` salvo lista blanca explícita), temporales `0700` con nombres aleatorios y aperturas `wx`/`0600`, desenlazar symlinks/junctions en vez de seguirlos, `dispose` espera a la salida de los hijos tras `kill`, excepciones de listeners aisladas.

### 3.5 Herencia de política
`isNarrowerOrEqual(parent, child)` (en `agent-sandbox`) compara dos `SandboxPolicyConfig` resueltos y es verdadera solo si el hijo no es más amplio en ninguna dimensión: modo (`read-only` < `workspace-write` < `danger-full-access`), red (`none` < `allow`), raíces (subconjunto), nivel de aprobación (igual o más exigente), `writeTools`/`commandTools` (el hijo no puede quitar herramientas de escritura de la lista) y variables de entorno permitidas (subconjunto). La usan la creación de agentes de Hermes (SPEC-0003 §2.5) y los subagentes (SPEC-0005). Es función pura, sin I/O, y sus pruebas cubren cada dimensión.

## 4. Integración
`createCodingEngine({ sandbox: { preset: 'ask', backends: ['docker'] } })`; `createBaseEngine({ sandbox })` para herramientas propias vía `ctx.sandbox.run(...)` (se añade a `ExecutionContext`). Compatibilidad: sin `sandbox`, `run_command` mantiene su comportamiento (incluido `BK_RUN_COMMAND_SANDBOX`, que se traduce a la política equivalente y queda deprecado).

## 5. Pruebas y aceptación
- Matriz modo × backend: `read-only` impide escribir fuera y dentro; `workspace-write` escribe solo dentro; fuera → denegado.
- Backend no disponible (docker detenido) → `SANDBOX_UNAVAILABLE`, nunca ejecución en el host.
- Entorno: `env` dentro del sandbox no contiene `DEEPSEEK_API_KEY` ni equivalentes.
- Elevación: concedida una vez, no se arrastra a la llamada siguiente; sin aprobador → falla cerrado.
- Teardown: abortar un comando largo deja 0 procesos (comprobado externamente).
- En Windows: pruebas reales en CI de Windows para el backend elegido.

## 6. Decisiones abiertas
- **D1 Windows:** (a) Job Object + token restringido en JS/PowerShell (menos fuerte, sin nativo), (b) ACL con SID de capacidad (fuerte, nativo, mantenimiento alto), (c) solo docker/WSL en Windows. Propuesta: (c) en la primera entrega y (a) como mejora; (b) solo si hay demanda.
- **D2** ¿Red por defecto `none` también fuera de docker? Propuesta: sí en `read-only`, `allow` configurable en `workspace-write`.
- **D3** ¿Deprecar `COMMAND_ALLOWLIST` fijo? Propuesta: pasa a ser *preset* configurable, no sustituto del confinamiento.

## 7. Registro

- **2026-11-26, `read-only` juzga por lo declarado ([ADR-0009](../adr/0009-lo-declarado-decide-el-efecto.md); agent-sandbox 0.1.24, agent-core 0.49.15).** Hasta entonces `read-only` rechazaba solo lo listado en `writeTools` (§3.5), vacío por defecto: una tool `destructive`, una MCP o una propia sin declarar corría. Ahora el motor pasa a `authorizeTool(caller, tool, facts?)` y `approvalFor(caller, tool, facts?)` los hechos de la tool (`SandboxToolFacts`): en `read-only` solo corre `readOnly: true`; lo no declarado cuenta como efecto. Nueva dimensión de la política, `ownStateTools`: tools que escriben solo el estado propio del agente (su memoria), que corren en `read-only` y no piden aprobación; una política hija solo exime lo que eximía la padre (se añade a §3.5). `writeTools` se queda como refuerzo.
- **2026-11-26, el backend docker monta las raíces de la política (§3.1).** Un comando con `cwd` en una de `roots`, fuera del workspace, pasaba la comprobación pero corría en un directorio vacío del contenedor. Ahora cada raíz se monta en `/roots/<n>` (`:ro` en `read-only`) y un `cwd` fuera de todos los montajes falla.
- **2026-11-27, la herencia compara raíces resueltas (auditoría E-03).** `checkNarrower` comparaba las raíces como texto, pero el servicio las resuelve (`realPathOf`) al juzgar una ruta: una raíz hija `/permitida/enlace` que apunta a `/etc` pasaba la herencia y luego abría `/etc`. Ahora las dos se resuelven antes de comparar, y una raíz que no se puede resolver (un bucle de enlaces) es una violación. Deja de ser una función sin I/O (§3.5): lee el disco para resolver enlaces.
