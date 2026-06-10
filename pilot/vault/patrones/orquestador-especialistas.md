---
title: "Patrón: Orquestador + Especialistas"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/patrón", "stack/multiagente"]
description: "El patrón central de los proyectos enterprise: un orquestador que delega a especialistas de dominio"
---

## Descripción

Un agente General recibe todas las consultas del usuario, detecta el dominio y delega
al especialista correspondiente. Los especialistas tienen acceso solo a las herramientas
y el contexto RAG de su área.

## Diagrama

```
Usuario → General (orquestador)
              ├── HR Agent       (herramientas: leave_request, payroll_query, search_knowledge[rrhh])
              ├── Sales Agent    (herramientas: crm_query, proposal_gen, search_knowledge[ventas])
              ├── Finance Agent  (herramientas: erp_query, report_gen, search_knowledge[finanzas])
              └── Ops Agent      (herramientas: metrics_query, incident_lookup, search_knowledge[ops])
```

## Implementación con BackendKit

```typescript
const GENERAL_PROFILE: AgentProfile = {
  id: 'general',
  name: 'General',
  description: 'Recibe consultas y delega al especialista correcto.',
  systemPrompt: `Eres el orquestador del equipo de agentes enterprise.
Analiza la consulta y usa ask_agent para delegar al especialista correcto:
- RRHH/empleados/vacaciones → hr-agent
- Ventas/clientes/propuestas → sales-agent
- Finanzas/facturas/reportes → finance-agent
- Operaciones/métricas/incidentes → ops-agent`,
  allowedTools: ['ask_agent'],
  delegatesTo: ['hr-agent', 'sales-agent', 'finance-agent', 'ops-agent'],
};

const HR_PROFILE: AgentProfile = {
  id: 'hr-agent',
  name: 'HR Specialist',
  provider: 'local',   // dato sensible → Ollama local
  systemPrompt: 'Eres el especialista de RRHH. ...',
  allowedTools: ['search_knowledge', 'leave_request', 'payroll_query'],
};
```

## Cuándo aplica

- Proyecto con 2+ dominios funcionales distintos
- Datos de distintos niveles de confidencialidad
- Consultas que pueden tocar múltiples áreas (el General coordina)

## Variantes

**Delegación en paralelo:** si la consulta toca múltiples áreas, el General puede
delegar a varios especialistas en paralelo y consolidar los resultados.

**Especialista sin orquestador:** para proyectos pequeños, el especialista puede
recibir consultas directamente sin pasar por un General.
