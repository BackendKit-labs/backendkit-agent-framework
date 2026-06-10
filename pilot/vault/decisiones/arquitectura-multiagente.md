---
title: "Decisión: Cuándo usar arquitectura multi-agente"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/decisión", "stack/multiagente"]
description: "Reglas para decidir entre agente único vs orquestador + especialistas"
---

## Contexto

No todos los proyectos necesitan múltiples agentes. Agregar agentes tiene un costo:
más latencia por delegación, más contexto a manejar, más prompt engineering.

## Regla de decisión

**Agente único** cuando:
- El dominio es acotado (ej. solo responde preguntas de RRHH)
- Las herramientas son homogéneas (todas del mismo sistema)
- El volumen de tools es bajo (< 6)
- Un solo perfil de razonamiento cubre todos los casos

**Orquestador + especialistas** cuando:
- Hay 2+ dominios claramente separados (RRHH, ventas, finanzas)
- Los agentes necesitan proveedores distintos (local para sensible, cloud para razonamiento)
- Las consultas pueden requerir información de múltiples áreas simultáneamente
- Los especialistas tienen skills o contexto RAG diferente según su dominio

## Threshold práctico

Si el proyecto tiene ≥ 3 áreas funcionales distintas O ≥ 8 tools → multi-agente.

## Estructura recomendada

```
General (orquestador)
├── HR Agent        → docs RRHH + herramientas de nómina
├── Sales Agent     → CRM + docs ventas
├── Finance Agent   → ERP + docs finanzas
└── Ops Agent       → métricas + runbooks
```

El General solo orquesta — no tiene tools propias, solo `ask_agent`.
Los especialistas no se llaman entre sí — pasan por el General.

## Anti-patrones a evitar

- **Orquestador con tools**: el General no debería tener tools de dominio, solo delegar
- **Especialistas que se llaman entre sí**: crea ciclos y hace el flujo difícil de auditar
- **Demasiados agentes**: más de 6-8 especialistas raramente agrega valor; mejor skills
- **Agente por herramienta**: si solo hay una tool, no hace falta un agente dedicado
