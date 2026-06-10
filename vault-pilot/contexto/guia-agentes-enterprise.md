---
title: "Guía: Crear un Agente Enterprise"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/guía", "stack/typescript"]
description: "Pasos para crear un agente enterprise con RAG, memoria y Ollama"
---

## Componentes mínimos

Un agente enterprise necesita:
1. **ObsidianRAGProvider** — acceso al vault de conocimiento
2. **VaultWriter** — capacidad de escribir al vault
3. **MemorySystem** — memoria privada (episódica, semántica, procedimental)
4. **OllamaProvider** — modelo LLM local
5. **AgentProfile** — definición de rol, system prompt y tools permitidas

## Estructura de un AgentProfile

```typescript
const ANALYST_PROFILE: AgentProfile = {
    id: 'analyst',
    name: 'Analista Técnico',
    description: 'Analiza problemas técnicos y documenta decisiones en el vault',
    systemPrompt: `You are a technical analyst...`,
    allowedTools: ['search_knowledge', 'write_knowledge', 'memory_save_knowledge'],
};
```

## Consideraciones de system prompt

- Instruir al agente explícitamente sobre CUÁNDO escribir al vault vs cuándo usar memoria privada.
- Vault = conocimiento que otros (agentes o humanos) necesitan conocer.
- Memoria privada = contexto operativo del propio agente.
- El system prompt debe estar en inglés para máxima compatibilidad con modelos locales pequeños.

## Tools disponibles en el template enterprise

| Tool | Fuente | Propósito |
|---|---|---|
| `search_knowledge` | ObsidianRAGProvider | Leer vault organizacional |
| `write_knowledge` | VaultWriter | Escribir al vault organizacional |
| `memory_remember` | MemorySystem | Log de experiencias privadas |
| `memory_save_knowledge` | MemorySystem | Conocimiento semántico privado |
| `memory_learn_pattern` | MemorySystem | Patrones de éxito/fallo |
| `ask_agent` | AgentEngine | Delegar a otro agente |
