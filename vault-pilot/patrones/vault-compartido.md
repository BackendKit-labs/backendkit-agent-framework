---
title: "Patrón: Vault Compartido entre Agentes"
date: 2026-06-01
tags: ["área/rag", "área/multi-agent", "tipo/patrón"]
description: "Cómo múltiples agentes y humanos comparten conocimiento via vault Obsidian"
---

## Concepto

El vault es la memoria organizacional de largo plazo — distinta de la memoria privada
de cada agente (MemorySystem episódica/semántica/procedimental).

| Capa | Dónde | Alcance | Quién escribe |
|---|---|---|---|
| SessionMemory | engine | una sesión | engine |
| agent-memory (MemorySystem) | JSON por agente | privada, largo plazo | el agente |
| Vault Obsidian | directorio compartido | organizacional | agentes + humanos |

## Flujo de automejora

```
sesión → agente lee vault (search_knowledge)
              ↓
         razona + actúa
              ↓
         escribe hallazgo (write_knowledge)
              ↓
         próxima sesión encuentra ese conocimiento
```

## Convención de notas escritas por agentes

Las notas escritas por agentes van en la subcarpeta `agentes/` con frontmatter estándar:
- `author: "agent/<agentId>"`
- `date: <ISO date>`
- `tags: ["función/<dominio>"]`
- `description: "<una línea>"`

## Supervisión humana

Los humanos pueden editar cualquier nota del vault. El próximo `index()` la re-embede
automáticamente (el mtime cambia). Esto permite corregir o enriquecer lo que un agente escribió.

## Escritura concurrente

En producción con múltiples procesos: cada escritura debe ser un archivo nuevo (nunca
editar archivos compartidos concurrentemente). VaultWriter usa timestamp en el nombre
para garantizar unicidad.
