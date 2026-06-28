/**
 * Casos de Uso Avanzados — schedule-agent
 * =========================================
 *
 * Este archivo documenta y demuestra los casos de uso avanzados
 * que el schedule-agent soporta. No se ejecuta automáticamente;
 * es una guía de referencia para integradores.
 *
 * Requisitos:
 * - Un MCP host (Claude Desktop, Cline, etc.) con el schedule-agent registrado
 * - Las tools se invocan vía MCP, no directamente
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 1: Gate timeout — one_time que se cancela si alguien aprueba antes
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: Un revisor debe aprobar un cambio. Si no lo hace en 24h,
 * el sistema escala automáticamente al gerente.
 *
 * // 1. Programar la tarea de escalación
 * // schedule_task({
 * //   type: "one_time",
 * //   when: "+24h",  // o ISO 8601: new Date(Date.now() + 86400000).toISOString()
 * //   workflow: "escalate-approval",
 * //   workflowInput: {
 * //     requestId: "req-123",
 * //     reviewer: "juan@empresa.com",
 * //     manager: "gerencia@empresa.com",
 * //     reason: "Approval pending for 24 hours"
 * //   },
 * //   createdBy: "sistema",
 * //   userRole: "admin",
 * //   notifyOnFailure: true,
 * //   notifyTo: ["admin@empresa.com"]
 * // })
 * // → { id: "uuid-1", status: "active", nextRunAt: "2026-06-19T10:00:00.000Z" }
 *
 * // 2. Si alguien aprueba antes → cancelar la tarea
 * // cancel_task({
 * //   id: "uuid-1",
 * //   reason: "Approved by manager on time",
 * //   requestedBy: "juan@empresa.com",
 * //   userRole: "admin"
 * // })
 * // → { id: "uuid-1", status: "cancelled", cancelledAt: "2026-06-18T11:30:00.000Z" }
 *
 * // 3. Si NADIE aprueba en 24h → el engine ejecuta escalate-approval
 * //    automáticamente. El orquestador recibe el workflowInput y
 * //    envía la notificación al gerente.
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 2: Informe recurrente mensual con workflowInput complejo
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: El día 29 de cada mes a las 9 AM (ARG), generar un
 * informe de salud del sistema y enviarlo por email a gerencia.
 *
 * // schedule_task({
 * //   type: "cron",
 * //   cron: "0 9 29 * *",
 * //   timezone: "America/Argentina/Buenos_Aires",
 * //   workflow: "health-report-email",
 * //   workflowInput: {
 * //     to: ["gerencia@empresa.com", "ops@empresa.com"],
 * //     include: {
 * //       vault: true,
 * //       fleet: true,
 * //       runs: true,
 * //       agents: ["scheduler", "orchestrator", "notifier"]
 * //     },
 * //     format: "pdf",
 * //     retentionDays: 90
 * //   },
 * //   createdBy: "admin",
 * //   userRole: "admin",
 * //   notifyOnFailure: true,
 * //   notifyTo: ["ops@empresa.com"]
 * // })
 * // → { id: "uuid-2", status: "active", nextRunAt: "2026-06-29T12:00:00.000Z" }
 * //   (12:00 UTC = 09:00 ART)
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 3: Deploy automático semanal con notificación en fallo
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: Cada lunes a las 10 AM se deploya a staging.
 * Si el deploy falla, se notifica al equipo de admin.
 *
 * // schedule_task({
 * //   type: "cron",
 * //   cron: "0 10 * * 1",
 * //   timezone: "America/Buenos_Aires",
 * //   workflow: "deploy-staging",
 * //   workflowInput: {
 * //     environment: "staging",
 * //     branch: "main",
 * //     autoRollback: true,
 * //     slackChannel: "#deploys"
 * //   },
 * //   createdBy: "devops-bot",
 * //   userRole: "admin",
 * //   notifyOnFailure: true,
 * //   notifyTo: ["admin@empresa.com", "#deploys"]
 * // })
 * // → { id: "uuid-3", status: "active", nextRunAt: "2026-06-22T13:00:00.000Z" }
 *
 * // Si el deploy falla, el engine:
 * // 1. Marca la tarea como "failed"
 * // 2. Registra el error en executionHistory
 * // 3. Llama a NotificationClient.notify() con el mensaje de error
 * // 4. La notificación aparece en console.error y (si hay callback) en el canal externo
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 4: Recordatorio one_time con datos contextuales
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: Recordarle a un usuario que complete su perfil
 * 48 horas después de registrarse.
 *
 * // schedule_task({
 * //   type: "one_time",
 * //   when: new Date(Date.now() + 172800000).toISOString(),  // +48h
 * //   workflow: "send-reminder",
 * //   workflowInput: {
 * //     userId: "user-abc-123",
 * //     type: "profile-completion",
 * //     template: "onboarding-reminder",
 * //     channels: ["email", "in-app"],
 * //     priority: "medium"
 * //   },
 * //   createdBy: "onboarding-service",
 * //   userRole: "admin"
 * // })
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 5: Consulta de estado y auditoría
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: Verificar el historial de ejecuciones de una tarea
 * para auditoría o debugging.
 *
 * // task_status({
 * //   id: "uuid-2",
 * //   requestedBy: "auditor",
 * //   userRole: "admin"
 * // })
 * // → {
 * //     id: "uuid-2",
 * //     type: "cron",
 * //     status: "active",
 * //     runCount: 5,
 * //     lastRunAt: "2026-05-29T12:00:00.000Z",
 * //     nextRunAt: "2026-06-29T12:00:00.000Z",
 * //     executionHistory: [
 * //       { executedAt: "...", status: "success", duration: 3200, ... },
 * //       { executedAt: "...", status: "success", duration: 2800, ... },
 * //       ...
 * //     ]
 * //   }
 *
 * // Listar todas las tareas activas de un usuario
 * // list_scheduled({
 * //   status: "active",
 * //   createdBy: "onboarding-service",
 * //   userRole: "admin",
 * //   limit: 50,
 * //   offset: 0
 * // })
 *
 * ────────────────────────────────────────────────────────────────
 *
 * Caso 6: Reprogramación con cambio de input
 * ────────────────────────────────────────────────────────────────
 *
 * Escenario: Un informe semanal necesita cambiar sus parámetros
 * sin perder el historial de ejecuciones.
 *
 * // reschedule({
 * //   id: "uuid-3",
 * //   cron: "0 11 * * 1",        // cambiar a 11 AM
 * //   timezone: "America/Buenos_Aires",
 * //   workflowInput: {
 * //     ...existingInput,
 * //     branch: "develop",       // cambiar rama
 * //     notifyTo: ["nuevo@empresa.com"]
 * //   },
 * //   requestedBy: "devops-bot",
 * //   userRole: "admin"
 * // })
 * // → { id: "uuid-3", status: "active", nextRunAt: "...", updatedAt: "..." }
 */
