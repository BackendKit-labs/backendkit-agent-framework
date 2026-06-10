---
title: "BackendKit Agent Framework — Visión General"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/contexto"]
description: "Contexto general del proyecto: qué es, qué resuelve y qué no resuelve"
---

## Qué es BackendKit

BackendKit Agent Framework es un monorepo TypeScript para construir agentes IA enterprise
que corren 100% on-premise usando modelos locales (Ollama). No envía datos a servicios externos.

Los agentes pueden coordinarse entre sí (multi-agent), usar herramientas externas (MCP),
consultar una base de conocimiento local (RAG con Obsidian) y aprender de sus propias
experiencias (MemorySystem de tres capas).

## Principios de diseño

- **Local primero**: ningún modelo externo, ninguna API de terceros obligatoria.
- **Enterprise**: aprobación de herramientas, audit log, auth por agente, historial persistente.
- **Extensible**: ToolRegistry, AgentRegistry, ProviderRegistry — todo reemplazable.
- **Transparente**: cada evento (token, tool call, delegación) emitido vía CallbackTransport.

## Lo que no es

No es un orquestador de workflows deterministas (para eso existe LangGraph o Temporal).
No es un wrapper de OpenAI. No tiene dependencia con ningún proveedor cloud.

## Stack actual

- TypeScript 5.4+ strict mode
- Ollama para LLM e embeddings (nomic-embed-text por defecto)
- Jest + ts-jest para tests
- Workspaces npm: core, coding, enterprise, mcp-server
