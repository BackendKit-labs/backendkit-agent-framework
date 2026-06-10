---
title: "Decisión: Bulkhead y Semáforo de Concurrencia"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/decisión", "stack/typescript"]
description: "Cómo controlar la concurrencia de delegaciones sin deadlock"
---

## Contexto

El DelegationBus usa un Bulkhead (semáforo con maxConcurrentCalls=6, maxQueueSize=50)
para limitar delegaciones simultáneas. El problema: cuando un agente delega a otro
(ask_agent), ese sub-agente también intenta tomar un slot del mismo semáforo.
Con 6 slots ocupados, la delegación anidada se bloquea indefinidamente → deadlock.

## Decisión tomada

Agregar un parámetro `depth` que se propaga por toda la cadena de delegación.
Las llamadas con `depth > 0` bypasean el bulkhead completamente — usan `execute()`
directo en vez de `bulkhead.execute(execute)`.

## Por qué funciona

El bulkhead solo tiene sentido en el nivel raíz para proteger recursos del sistema.
Las delegaciones anidadas ya están "dentro" de un slot raíz — no consumen capacidad
adicional significativa desde el punto de vista del sistema operativo.

## Implementación relevante

```typescript
// DelegationBus.ts
depth > 0 ? execute() : bulkhead.execute(execute)
```

El `depth` se pasa como argumento en toda la cadena:
`runAgentInternal(id, question, context, depth)` →
`buildContext(agentId, depth)` →
`askAgent(id, q, depth + 1)`

## Lecciones

- No usar semáforos globales en sistemas con recursión. Usar semáforos por nivel o límites de profundidad.
- Siempre propagar `depth` explícitamente — no inferirlo del call stack.
