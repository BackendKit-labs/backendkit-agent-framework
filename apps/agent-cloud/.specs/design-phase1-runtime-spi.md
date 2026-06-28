# Design — Fase 1: Despliegue real de agentes vía RuntimeSPI

> Objetivo: convertir el `DockerService` falso (in-memory `Map`) en un motor de
> despliegue **real y extensible**, usando el patrón SPI + Adapter + Registry
> (inspirado en `floci-ui`). El `director` queda *runtime-agnóstico*: hoy
> despliega en Docker, mañana en k8s o como proceso local, sin tocar su lógica.

## Principios (robados a floci-ui)

1. **El director no conoce runtimes.** Habla solo con el `RuntimeSPI`.
2. **El SPI define el contrato.** Una interfaz estable de ciclo de vida de agentes.
3. **Los adapters traducen.** `docker` (dockerode), `k8s`, `process`.
4. **El registry enruta.** `Map<RuntimeKind, RuntimeAdapter>`.
5. **Cero datos falsos.** Lo no implementado se marca `coming_soon` *con motivo*,
   nunca se simula éxito. (Mata el pecado original del `DockerService` actual.)
6. **Estado persistente, no in-memory.** El handle del runtime se guarda en la BD
   y se reconcilia por labels al arrancar — sobrevive a reinicios del backend.

---

## 1. El contrato: `RuntimeSPI`

`src/runtime/runtime.spi.ts`

```ts
export type RuntimeKind = 'docker' | 'k8s' | 'process';
export type RuntimeAvailability = 'available' | 'coming_soon';
export type CapabilityStatus = 'available' | 'partial' | 'blocked' | 'coming_soon';
export type RuntimePhase = 'pending' | 'running' | 'stopped' | 'failed' | 'unknown';

/** Lo que el director quiere desplegar (independiente del runtime). */
export interface AgentSpec {
  agentId: string;
  name: string;
  image: string;                       // imagen OCI (o comando, para process)
  env?: Record<string, string>;
  command?: string[];
  labels?: Record<string, string>;
  ports?: Array<{ container: number; host?: number }>;
  volumes?: Array<{ source: string; target: string; readOnly?: boolean }>;
  resources?: { cpus?: number; memoryMb?: number };
}

/** Referencia opaca a la instancia desplegada (container id, pod name, pid). */
export interface RuntimeHandle {
  id: string;
  kind: RuntimeKind;
  agentId: string;
  name: string;
  phase: RuntimePhase;
  createdAt: string;
}

export interface RuntimeStatus {
  phase: RuntimePhase;
  message?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
}

export interface ExecResult { exitCode: number; stdout: string; stderr: string; }
export interface LogOptions { tail?: number; since?: string; follow?: boolean; }

/** Capacidad declarada por adapter (alimenta la UI: qué está disponible y por qué no). */
export interface RuntimeCapability {
  name: 'deploy' | 'stop' | 'remove' | 'logs' | 'exec' | 'stream-logs';
  status: CapabilityStatus;
  reason?: string;
}

/** Salud a nivel daemon (análogo a CloudStatus de floci). */
export interface RuntimeDaemonStatus {
  kind: RuntimeKind;
  registered: boolean;
  reachable: 'reachable' | 'unavailable' | 'coming_soon';
  endpoint: string | null;
  version?: string | null;
  checkedAt: string;
  error: string | null;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  readonly availability: RuntimeAvailability;
  capabilities(): RuntimeCapability[];
  ping(): Promise<RuntimeDaemonStatus>;
  deploy(spec: AgentSpec): Promise<RuntimeHandle>;
  stop(handleId: string): Promise<void>;
  remove(handleId: string): Promise<void>;
  status(handleId: string): Promise<RuntimeStatus>;
  logs(handleId: string, opts?: LogOptions): Promise<string>;
  exec(handleId: string, command: string): Promise<ExecResult>;
  list(): Promise<RuntimeHandle[]>;
  /** Opcional: streaming en vivo (SSE). Si no existe, la UI usa logs() con polling. */
  streamLogs?(handleId: string, opts?: LogOptions): AsyncIterable<string>;
}
```

---

## 2. El registry

`src/runtime/runtime.registry.ts`

```ts
@Injectable()
export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  /** Devuelve un adapter usable o lanza 503 si falta / es coming_soon. */
  require(kind: RuntimeKind): RuntimeAdapter {
    const a = this.adapters.get(kind);
    if (!a) throw new ServiceUnavailableException(`Runtime '${kind}' no registrado`);
    if (a.availability === 'coming_soon')
      throw new ServiceUnavailableException(`Runtime '${kind}' aún no disponible (coming_soon)`);
    return a;
  }

  get(kind: RuntimeKind): RuntimeAdapter | undefined { return this.adapters.get(kind); }
  all(): RuntimeAdapter[] { return [...this.adapters.values()]; }
  availableKinds(): RuntimeKind[] {
    return this.all().filter(a => a.availability === 'available').map(a => a.kind);
  }
}
```

---

## 3. `adapter-docker` (la implementación real — dockerode)

`src/runtime/adapters/docker.adapter.ts`

Decisiones:
- **Cliente:** `dockerode`, conectado por `DOCKER_HOST` (default `unix:///var/run/docker.sock`;
  en Windows `npipe:////./pipe/docker_engine`).
- **Labels de gestión** en *cada* contenedor para poder reconciliar tras un reinicio:
  - `agent-cloud.managed = "true"`
  - `agent-cloud.agentId = <id>`
- **deploy:** `pull` (si falta la imagen) → `createContainer` (env, labels, HostConfig
  con límites de CPU/mem, port bindings) → `start`. Devuelve el `RuntimeHandle`.
- **status:** `inspect` → mapear `State` a `RuntimePhase`
  (`running`→running, `exited`+code 0→stopped, `exited`+code≠0→failed, etc.).
- **logs:** `container.logs({ stdout, stderr, tail })` con demux de stream.
- **exec:** `container.exec` + `start` → recolectar stdout/stderr/exitCode.
- **list:** `listContainers({ all: true, filters: { label: ['agent-cloud.managed=true'] } })`.
- **ping:** `docker.ping()` + `docker.version()` → `RuntimeDaemonStatus`.

```ts
@Injectable()
export class DockerRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'docker' as const;
  readonly availability = 'available' as const;
  private readonly docker = new Docker(parseDockerHost(process.env.DOCKER_HOST));

  capabilities(): RuntimeCapability[] {
    return [
      { name: 'deploy', status: 'available' },
      { name: 'stop',   status: 'available' },
      { name: 'remove', status: 'available' },
      { name: 'logs',   status: 'available' },
      { name: 'exec',   status: 'available' },
      { name: 'stream-logs', status: 'partial', reason: 'SSE follow llega después' },
    ];
  }

  async ping(): Promise<RuntimeDaemonStatus> {
    try {
      await this.docker.ping();
      const v = await this.docker.version();
      return { kind: this.kind, registered: true, reachable: 'reachable',
               endpoint: dockerHostLabel(), version: v.Version, checkedAt: now(), error: null };
    } catch (e) {
      return { kind: this.kind, registered: true, reachable: 'unavailable',
               endpoint: dockerHostLabel(), checkedAt: now(), error: (e as Error).message };
    }
  }

  async deploy(spec: AgentSpec): Promise<RuntimeHandle> {
    await this.ensureImage(spec.image);
    const container = await this.docker.createContainer({
      name: `agent-${spec.agentId}`,
      Image: spec.image,
      Env: toEnvArray(spec.env),
      Labels: { 'agent-cloud.managed': 'true', 'agent-cloud.agentId': spec.agentId, ...spec.labels },
      Cmd: spec.command,
      HostConfig: buildHostConfig(spec),   // límites + port bindings + volumes
    });
    await container.start();
    return { id: container.id, kind: this.kind, agentId: spec.agentId,
             name: spec.name, phase: 'running', createdAt: now() };
  }
  // stop / remove / status / logs / exec / list ...
}
```

---

## 4. Adapters `coming_soon` (disciplina anti-fake)

`k8s.adapter.ts` y `process.adapter.ts` **existen pero no fingen**:

```ts
@Injectable()
export class K8sRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'k8s' as const;
  readonly availability = 'coming_soon' as const;
  capabilities(): RuntimeCapability[] {
    return ['deploy','stop','remove','logs','exec'].map(name => ({
      name, status: 'coming_soon', reason: 'Adapter k8s planificado (Fase 4)',
    })) as RuntimeCapability[];
  }
  async ping() { return comingSoonStatus(this.kind); }
  async deploy(): Promise<RuntimeHandle> { throw new ServiceUnavailableException('k8s: coming_soon'); }
  // resto: lanzan coming_soon
}
```

- `process` envolvería tu `MCPClientManager` del agent-framework → unificaría
  agentes-proceso y agentes-contenedor bajo el mismo control-plane (gran sinergia).

---

## 5. Refactor del `DirectorService`

- **Inyecta `RuntimeRegistry`** en vez de `DockerService` (se retira `src/docker/`).
- `deployAgent(dto)`: lee el `Agent` por id → arma `AgentSpec` → elige adapter por
  `agent.runtime` → `adapter.deploy(spec)` → **persiste el handle en la BD**.
- `stop/execute/logs`: leen el `runtimeHandle` persistido y llaman al adapter por
  `agent.runtime`. Se elimina el `Map agentContainers` in-memory.

```ts
async deployAgent(dto: DeployAgentDto) {
  const agent = await this.agents.findOneOrFail({ where: { id: dto.agentId } });
  const adapter = this.runtimes.require(agent.runtime);          // 503 si no disponible
  const handle = await adapter.deploy({
    agentId: agent.id, name: agent.name,
    image: agent.image ?? (agent.config?.image as string) ?? DEFAULT_AGENT_IMAGE,
    env: { AGENT_ID: agent.id, AGENT_TYPE: agent.type, ...(agent.model && { MODEL: agent.model }) },
  });
  agent.runtimeHandle = handle.id;
  agent.status = AgentStatus.ACTIVE;
  await this.agents.save(agent);
  return { id: agent.id, status: 'running', handle: handle.id, runtime: agent.runtime };
}
```

---

## 6. Cambios en el modelo (`Agent` entity)

Nuevas columnas:
| Columna | Tipo | Default | Uso |
|---|---|---|---|
| `runtime` | enum `RuntimeKind` | `'docker'` | qué adapter usa |
| `image` | varchar null | — | imagen OCI a desplegar |
| `runtimeHandle` | varchar null | — | id del contenedor/pod (persistente) |

> Elimina la dependencia del `Map` in-memory: el estado vive en Postgres y se
> reconcilia por labels al boot.

---

## 7. Wiring NestJS (`RuntimeModule`)

```ts
@Module({
  providers: [
    RuntimeRegistry,
    DockerRuntimeAdapter, K8sRuntimeAdapter, ProcessRuntimeAdapter,
  ],
  exports: [RuntimeRegistry],
})
export class RuntimeModule implements OnModuleInit {
  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly docker: DockerRuntimeAdapter,
    private readonly k8s: K8sRuntimeAdapter,
    private readonly process: ProcessRuntimeAdapter,
  ) {}
  onModuleInit() {
    const enabled = (process.env.RUNTIME_ENABLED ?? 'docker').split(',');
    if (enabled.includes('docker')) this.registry.register(this.docker);
    this.registry.register(this.k8s);       // queda como coming_soon
    this.registry.register(this.process);   // queda como coming_soon
  }
}
```
`DirectorModule` importa `RuntimeModule`.

---

## 8. Superficie de API nueva

- `GET /api/director/runtimes` → `[{ kind, availability, capabilities, daemon: ping() }]`.
  Es lo que la UI usa para mostrar runtimes reales y `coming_soon` con motivo
  (en vez de inventar). `getHealth()` pasa a agregar `ping()` de los adapters.
- `deploy/stop/execute/logs` ya existentes ahora pasan por el registry.

---

## 9. Config / despliegue

`.env`:
```bash
DOCKER_HOST=unix:///var/run/docker.sock   # Windows: npipe:////./pipe/docker_engine
RUNTIME_ENABLED=docker
DEFAULT_AGENT_IMAGE=agent-runtime:latest
```

`docker-compose.yml` — montar el socket en el servicio `app`:
```yaml
  app:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # Docker-out-of-Docker
```

> ⚠️ **Seguridad:** montar el socket = root-equivalente en el host. Aceptable en
> local/dev. Para prod: usar un *socket proxy* (tecnvest/docker-socket-proxy) con
> verbos restringidos, o saltar al `adapter-k8s` con ServiceAccount + RBAC.

---

## 10. Reconciliación al arranque

`RuntimeReconciler` (onModuleInit, tras registrar adapters):
1. Por cada adapter `available`: `list()` (contenedores con label `agent-cloud.managed`).
2. Cruzar con la tabla `agents` (`runtimeHandle`).
3. Actualizar `status` de cada agente con el `phase` real; marcar `failed` los
   handles huérfanos. Resuelve el bug actual de perder todo al reiniciar.

---

## 11. Dependencias

```
dockerode  @types/dockerode
```
(`@kubernetes/client-node` se agrega recién en Fase 4 con el adapter k8s.)

---

## 12. Layout de archivos

```
src/runtime/
  runtime.spi.ts          # contrato + tipos
  runtime.registry.ts
  runtime.module.ts
  runtime.reconciler.ts
  adapters/
    docker.adapter.ts     # real (dockerode)
    k8s.adapter.ts        # coming_soon
    process.adapter.ts    # coming_soon (futuro: MCPClientManager)
  runtime.helpers.ts      # parseDockerHost, buildHostConfig, mapPhase, ...
# se retira: src/docker/
```

---

## 13. Plan de implementación (orden de PRs)

1. **SPI + Registry + tipos** (+ test del registry, estilo floci). Sin tocar director.
2. **adapter-docker** real + helpers + `@types/dockerode`.
3. **Migración del modelo** (`runtime`, `image`, `runtimeHandle`).
4. **Refactor `DirectorService`** → registry; retirar `DockerService`/`DockerModule`.
5. **adapters coming_soon** (k8s, process) + `GET /runtimes`.
6. **Reconciler** + compose con socket.

---

## 14. Criterios de aceptación

- [ ] `POST /api/director/deploy { agentId }` crea un **contenedor Docker real**
      (verificable con `docker ps`), con labels `agent-cloud.*`.
- [ ] `:id/stop` lo detiene; `agents/:id/logs` devuelve logs **reales** del contenedor.
- [ ] `execute/:id { action }` corre el comando dentro del contenedor y devuelve salida real.
- [ ] `GET /api/director/runtimes` lista `docker: available` (con versión del daemon)
      y `k8s/process: coming_soon` con motivo. **Cero datos simulados.**
- [ ] Tras reiniciar el backend, el estado de los agentes desplegados se
      **reconcilia** desde Docker (no se pierde).
- [ ] Si el daemon Docker no está, `deploy` responde **503 explícito**, no un éxito falso.
- [ ] `npm run build` limpio; test del `RuntimeRegistry` en verde.
```
