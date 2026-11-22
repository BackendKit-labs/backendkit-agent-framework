← [Índice](./README.md)

# 04 · Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `AVAL_URL` | `http://localhost:3000` | Dónde vive AVAL |
| `AVAL_KEY` | — (exigida) | La credencial del **agente** en AVAL. Nunca la clave de consola |
| `DEEPSEEK_API_KEY` | — (exigida) | El proveedor del LLM que razona cada corrida |
| `SCHEDULE_CRON` | `0 9 * * *` (diario, 9:00) | Cuándo corre el cron |
| `PAYMENTS_SOURCE_PATH` | `~/.aval-scheduler/schedule.json` | Dónde vive el JSON del origen de pagos |
| `SCHEDULER_WEBHOOK_SECRET` | — (opcional) | Activa `POST /run-now` — secreto HMAC-SHA256 estilo GitHub |
| `SCHEDULER_WEBHOOK_PORT` | `3100` | Puerto del webhook, sólo si `SCHEDULER_WEBHOOK_SECRET` está definida |
| `ADMIN_TOKEN` | — (opcional) | Activa el [panel admin](./03-panel-admin.md) |
| `ADMIN_PORT` | `3200` | Puerto del panel, sólo si `ADMIN_TOKEN` está definida |

## Notas

- **`AVAL_KEY` tiene forma exigida**: `aval_sk_<keyId>_<secreto>`. `checkAval()` en `index.ts`
  la valida por regex antes de intentar nada — si el valor es literalmente `"aval_sk_..."`,
  todavía es el placeholder de `.env.example`, y el arranque falla con ese mensaje exacto en vez
  de un error de red confuso más tarde.
- **El arranque falla rápido, no en silencio.** Antes de levantar el motor, `checkAval()` llama a
  `GET /api/v1/verify` (sin credencial, ver la documentación de AVAL) para confirmar que el
  servidor responde y que su cadena está íntegra. Sin esto, una clave placeholder o un AVAL caído
  dejarían al proceso "corriendo" hasta la primera corrida real del cron — que puede ser horas
  después.
- **`SCHEDULER_WEBHOOK_SECRET` y `ADMIN_TOKEN` son apagado-por-defecto**, no
  apagado-si-está-vacío: si no están definidas, `index.ts` ni siquiera arma el trigger ni levanta
  el servidor correspondiente — no hay una ruta "protegida por un secreto vacío" que alguien
  pueda dejar así por descuido.
- **`PAYMENTS_SOURCE_PATH` es una sola ruta compartida** entre el subproceso MCP y el panel admin
  (si está activo) — los dos apuntan al mismo archivo a propósito, ver
  [01 · Arquitectura](./01-arquitectura.md#por-qué-el-store-lee-y-escribe-del-disco-en-cada-llamada).
  Cambiala si corrés varias instancias del agente en la misma máquina.
- **`SCHEDULER_WEBHOOK_PORT` y `ADMIN_PORT` no pueden coincidir entre sí ni con el puerto de
  AVAL** (3000 por defecto) — son tres servidores HTTP independientes que pueden convivir en la
  misma máquina.

---
← [03 · Panel admin](./03-panel-admin.md) · → [05 · Limitaciones](./05-limitaciones.md)
