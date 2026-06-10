---
title: "Patrón: Delegación Anidada entre Agentes"
date: 2026-06-01
tags: ["área/multi-agent", "tipo/patrón", "stack/typescript"]
description: "Cómo un agente delega a otro que a su vez puede delegar — sin deadlock"
---

## Cuándo usar

Cuando una tarea requiere un especialista que a su vez puede necesitar otro especialista.
Ejemplo: orquestador → analista → extractor de datos.

## Patrón

El agente raíz usa `ask_agent` con el id del especialista. El especialista recibe
la pregunta en su contexto y puede a su vez llamar `ask_agent` si lo necesita.

```
orquestador
  └─ ask_agent("analista", "analiza X")
       └─ analista (depth=1)
            └─ ask_agent("extractor", "extrae Y de X")   ← depth=2, bypasea bulkhead
                 └─ extractor (depth=2) → devuelve resultado
```

## Restricciones

- Máxima profundidad recomendada: **3 niveles**. Más profundo y el historial se infla.
- Cada nivel recibe el contexto del nivel superior — el especialista sabe quién lo llamó.
- El resultado de `ask_agent` es un string que el agente llamador inserta como tool_result.

## Anti-patrón a evitar

No llamar `ask_agent` con el mismo agentId del agente actual — crea un bucle infinito.
El engine no tiene detección de ciclos todavía (pendiente en mejorar-de-diseno.md).

## Configuración

En el profile del agente, incluir `ask_agent` en los tools permitidos:
```typescript
allowedTools: ['ask_agent', 'search_knowledge', 'write_knowledge']
```
