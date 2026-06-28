# QA — Auditoría Fase 2: Layout chat-first

> **Proyecto:** vscode-terminal
> **Etapa actual:** verify
> **Fecha:** 2026-06-18
> **Auditor:** QA Architect

---

## Resumen Ejecutivo

La Fase 2 está en VERIFY, pero el layout chat-first personalizado no se ha implementado. Solo existe el chat nativo de VS Code (`contrib/chat`), que no es una vista que reemplace al editor como requiere el criterio. Además, la Fase 1 tiene issues pendientes (debug/files no eliminados, sin script, sin placeholder) que deberían resolverse primero.

**VEREDICTO: NO-GO — El layout chat-first personalizado no fue implementado. Solo existe el chat nativo de VS Code.**

---

## Paso 1 — Criterios Funcionales

| # | Criterio | Resultado | Evidencia |
|---|----------|-----------|-----------|
| 1 | Chat view reemplaza al editor como vista principal | ❌ | No existe un directorio `workbench/chat/` con los componentes personalizados (chatView, chatInput, chatMessage, toolCallBlock, chatService). Solo existe `contrib/chat` que es el chat nativo de VS Code (GitHub Copilot), no una vista que reemplace al editor. |
| 2 | Input de texto con botón de envío en la parte inferior | ❌ | No existe `chatInput.ts` en `workbench/chat/`. El input nativo de VS Code existe en `contrib/chat/browser/input/` pero no es personalizado. |
| 3 | Mensajes del usuario y del agente se muestran en la conversación | ❌ | No existe `chatMessage.ts` personalizado. El renderizado de mensajes nativo de VS Code existe pero no está adaptado para el caso de uso del Director. |
| 4 | Tool calls se muestran como bloques expandibles con duración | ❌ | No existe `toolCallBlock.ts`. No hay componente personalizado para tool calls. |
| 5 | Indicadores de estado del sistema visibles en el área de chat | ❌ | No existe implementación de indicadores de estado (Vault, Fleet, Runs) en el área de chat. |

**Total: 0/5 criterios cumplidos** ❌

---

## Paso 2 — Dependencias con Fase 1

La Fase 2 no puede completarse sin resolver los issues de la Fase 1:

| Issue de Fase 1 | Impacto en Fase 2 |
|-----------------|-------------------|
| `debug/` y `files/` no eliminados | El workbench aún muestra debugger y file explorer, interfiriendo con el layout chat-first |
| Sin placeholder `empty-editor` | No hay una vista base sobre la cual construir el chat |
| Sin script `remove-features.sh` | La configuración no es reproducible |
| Build no verificado | No se sabe si los cambios compilan |

---

## Paso 3 — Verificación de Stack (ADRs)

### ADR-001: Fork de VS Code
**Veredicto:** ⚠️ Parcial (mismo estado que Fase 1)

### ADR-002: Webview para el chat, TreeView API para paneles
**Veredicto:** ❌ **No implementado.** No existe webview personalizada para el chat. El chat nativo de VS Code usa su propio sistema de renderizado, no una webview custom.

### ADR-003: Persistencia en JSON file
**Veredicto:** ⏳ Pendiente (corresponde a Fase 3)

---

## Plan de Remediación

| # | Acción | Prioridad |
|---|--------|-----------|
| 1 | Resolver issues de Fase 1: eliminar debug, files, crear script, crear empty-editor | Inmediata |
| 2 | Implementar `workbench/chat/chatView.ts` como webview que reemplace al editor | Alta |
| 3 | Implementar `workbench/chat/chatInput.ts` con input + botón de envío | Alta |
| 4 | Implementar `workbench/chat/chatMessage.ts` para renderizar mensajes | Alta |
| 5 | Implementar `workbench/chat/toolCallBlock.ts` para tool calls expandibles | Alta |
| 6 | Implementar `workbench/chat/chatService.ts` como cliente MCP | Alta |
| 7 | Agregar indicadores de estado del sistema en el área de chat | Media |

---

## VEREDICTO: NO-GO — El layout chat-first personalizado no fue implementado. Solo existe el chat nativo de VS Code. Se requiere implementar los 5 componentes de `workbench/chat/` y resolver los issues pendientes de la Fase 1.
