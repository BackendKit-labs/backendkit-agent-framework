export { AgentServer } from './server/AgentServer';
export type { AgentServerOptions, AuthHook, RateLimitOptions, MetricsOptions } from './server/AgentServer';

export { SessionManager } from './session/SessionManager';
export type { Session, SessionManagerOptions, EngineFactory } from './session/SessionManager';

export { WebSocketTransport } from './transport/WebSocketTransport';
export type { WsMessage } from './transport/WebSocketTransport';

export { MonitorBus } from './monitor/MonitorBus';
export type { MonitorFrame } from './monitor/MonitorBus';

// ── Auth ──────────────────────────────────────────────────────────────────────
export { JwtAuth } from './auth/JwtAuth';
export type { JwtAuthOptions, AuthUser } from './auth/JwtAuth';

// ── Metrics ───────────────────────────────────────────────────────────────────
export { MetricsCollector } from './metrics/MetricsCollector';
export type { MetricsCollectorOptions, RunEndFn } from './metrics/MetricsCollector';

// ── Session store ─────────────────────────────────────────────────────────────
export { InMemorySessionMetaStore, RedisSessionMetaStore } from './store/SessionMetaStore';
export type { SessionMeta, SessionMetaStore, RedisLike } from './store/SessionMetaStore';

// ── Trigger bus ───────────────────────────────────────────────────────────────
export { TriggerBus } from './trigger/TriggerBus';
export type {
    TriggerEngineFactory,
    TriggerDefinition,
    TriggerResult,
    CronTriggerDef,
    WebhookTriggerDef,
} from './trigger/TriggerBus';

export { HeadlessTransport } from './transport/HeadlessTransport';
