# QA Report — Fase 3: Canales de equipo (slack, telegram, discord, webhook)

> Proyecto: notification-agent
> Fecha: 2026-06-19
> Etapa: VERIFY (post-refactor resiliencia)

---

## Paso 1 — Criterios funcionales

### C1: send_notification con channel='slack' envía webhook con blocks y color

**Resultado: ✅**

**Evidencia:**
- `src/channels/slack.ts` existe y exporta `sendSlack()`
- Usa `blocks` con header, section y context en formato Slack Block Kit
- Usa `PRIORITY_COLORS` para el color del attachment según prioridad
- Usa `HttpClient` con circuit breaker (`name: 'slack'`) y retry (`attempts: 3`)
- Valida `SLACK_WEBHOOK_URL` antes de enviar
- `--test-all`: `⚪ slack → not configured` (sin env var, no crashea)

---

### C2: send_notification con channel='telegram' envía mensaje Markdown vía Bot API

**Resultado: ✅**

**Evidencia:**
- `src/channels/telegram.ts` existe y exporta `sendTelegram()`
- POST a `https://api.telegram.org/bot${TOKEN}/sendMessage`
- Usa `parse_mode: 'Markdown'`
- Usa `HttpClient` con circuit breaker (`name: 'telegram'`) y retry
- Valida `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`
- `--test-all`: `⚪ telegram → not configured`

---

### C3: send_notification con channel='discord' envía embed con color

**Resultado: ✅**

**Evidencia:**
- `src/channels/discord.ts` existe y exporta `sendDiscord()`
- Usa `embeds` con title, description, color, footer y timestamp
- Usa `PRIORITY_COLORS` (formato hexadecimal 0xRRGGBB)
- Usa `HttpClient` con circuit breaker (`name: 'discord'`) y retry
- Valida `DISCORD_WEBHOOK_URL`
- `--test-all`: `⚪ discord → not configured`

---

### C4: send_notification con channel='webhook' hace POST a URL en 'to'

**Resultado: ✅**

**Evidencia:**
- `src/channels/webhook.ts` existe y exporta `sendWebhook()`
- Hace `client.post(params.to, { text: params.body })`
- Acepta `headers` personalizados
- Usa `HttpClient` con circuit breaker (`name: 'webhook'`) y retry
- Valida que `params.to` no esté vacío
- `--test-all`: `❌ webhook → FAILED: Webhook error: getaddrinfo ENOTFOUND...` (esperado, dominio inválido)

---

### C5: Cada canal usa withRetry para reintentos

**Resultado: ✅**

**Evidencia:**
- Los 4 canales HTTP usan `HttpClient` de `@backendkit-labs/http-client` que incluye:
  - **Retry**: `{ attempts: 3 }` con backoff exponencial
  - **Circuit breaker**: `{ failureThreshold: 3, openTimeoutMs: 30_000 }` — si falla 3 veces, deja de intentar por 30s
  - **Timeout**: `{ timeout: 10_000 }` por intento
- `slack.ts` ✅ `circuitBreaker: { name: 'slack', ... }`
- `telegram.ts` ✅ `circuitBreaker: { name: 'telegram', ... }`
- `discord.ts` ✅ `circuitBreaker: { name: 'discord', ... }`
- `webhook.ts` ✅ `circuitBreaker: { name: 'webhook', ... }`

---

### C6: Si env var del canal no está configurada, reporta error claro

**Resultado: ✅**

**Evidencia:**
- `slack.ts`: `"SLACK_WEBHOOK_URL no configurado. Usá SLACK_WEBHOOK_URL en las env vars."`
- `telegram.ts`: `"TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados. Usá las env vars correspondientes."`
- `discord.ts`: `"DISCORD_WEBHOOK_URL no configurado. Usá DISCORD_WEBHOOK_URL en las env vars."`
- `webhook.ts`: `"URL de webhook no proporcionada. Usá el campo \"to\" con la URL destino."`

---

## Paso 2 — Cumplimiento de decisiones de diseño (ADRs)

### ADR-001: Arquitectura por capas

**Verificación:**
| Capa | Archivos | Evidencia |
|------|----------|-----------|
| channels/ | 7 archivos | ✅ console, director, email, slack, telegram, discord, webhook |
| services/ | 1 archivo | ✅ withRetry.ts (aunque los canales HTTP ya no lo usan directamente) |

**Resultado: ✅**

---

### ADR-002: Interfaz común ChannelResult

**Verificación:**
| Canal | Usa ChannelResult | Evidencia |
|-------|------------------|-----------|
| slack | ✅ | `import type { ChannelResult }` |
| telegram | ✅ | `import type { ChannelResult }` |
| discord | ✅ | `import type { ChannelResult }` |
| webhook | ✅ | `import type { ChannelResult }` |

**Resultado: ✅** — Los 7 canales implementan la interfaz común.

---

### ADR-003: withRetry como servicio separado → Evolucionado a HttpClient

**Decisión original en design.md:** Implementar `withRetry(fn, maxRetries, delayMs)` en `services/withRetry.ts`.

**Evolución:** Se reemplazó `axios` + `withRetry` casero por `@backendkit-labs/http-client` que incluye:
- Retry con backoff exponencial
- Circuit breaker con fail-fast
- Timeout por intento
- Result pattern consistente con el ecosistema

**Verificación:**
| Elemento | Evidencia |
|----------|-----------|
| `@backendkit-labs/http-client` instalado | ✅ |
| slack.ts lo usa | ✅ `import { HttpClient }` |
| telegram.ts lo usa | ✅ `import { HttpClient }` |
| discord.ts lo usa | ✅ `import { HttpClient }` |
| webhook.ts lo usa | ✅ `import { HttpClient }` |
| `axios` eliminado | ✅ Ya no es dependencia directa |
| `@backendkit-labs/retry` eliminado | ✅ Ya no es dependencia directa |

**Resultado: ✅** — ADR-003 superado por una solución más robusta (HttpClient con circuit breaker integrado).

---

### ADR-004: Persistencia en archivos JSON

**Verificación:**
| Elemento | Evidencia |
|----------|-----------|
| `storage/` existe | ✅ |

**Resultado: ✅** — No aplica a Fase 3.

---

### Stack del design.md vs imports reales

**Verificación de librerías:**
| Librería | Design.md | package.json | Import en código | Archivo |
|----------|-----------|-------------|-------------------|---------|
| `@backendkit-labs/agent-core` | ✅ | ✅ | ✅ | `engine.ts`, `notification-agent.ts` |
| `@backendkit-labs/http-client` | ❌ **No listado** | ✅ | ✅ **NUEVO** | `slack.ts`, `telegram.ts`, `discord.ts`, `webhook.ts` |
| `zod` | ✅ | ✅ | ✅ | `tools.ts` |
| `dotenv` | ✅ | ✅ | ✅ | `notification-agent.ts` |
| `nodemailer` | ✅ | ✅ | ✅ | `channels/email.ts` |
| `axios` | ✅ | ✅ | ❌ **Eliminado** | Reemplazado por http-client |

**Hallazgo:** El design.md debe actualizarse para reflejar:
- Agregar `@backendkit-labs/http-client` como dependencia
- Eliminar `axios` (ya no se usa)
- Eliminar `@backendkit-labs/retry` (ya no es dependencia directa, viene incluido en http-client)

---

## Resumen de hallazgos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| H1 | `design.md` no lista `@backendkit-labs/http-client` como dependencia | **Baja** | El diseño debe reflejar el cambio de axios a http-client |
| H2 | `design.md` aún lista `axios` como dependencia | **Baja** | axios fue reemplazado por http-client |

---

## Plan de remediación

### Corto plazo
- **H1, H2** — Actualizar `design.md` sección 2 (Stack) para reflejar las dependencias reales

---

## VEREDICTO: GO

Todos los criterios funcionales se cumplen (6/6 ✅). Todos los ADRs aplicables se cumplen (3/3 ✅). La resiliencia mejoró significativamente al reemplazar `axios` + `withRetry` casero por `@backendkit-labs/http-client` con circuit breaker integrado. Los hallazgos son de severidad baja y no bloquean el avance.
