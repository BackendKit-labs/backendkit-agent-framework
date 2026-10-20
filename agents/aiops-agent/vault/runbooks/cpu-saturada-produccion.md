---
title: "Runbook CPU saturada en producción"
description: "Qué hacer cuando un servidor de producción supera el 95% de CPU: capacidad primero, reinicio nunca de forma autónoma."
area: infra
tipo: runbook
tags: ["runbook", "cpu", "produccion", "área/infra"]
aplica_a: ["prod"]
source_ref: "politica P-02"
---

## Síntomas
CPU sostenida por encima del 95% en un servidor de producción, latencia alta o alertas de saturación.

## Acciones recomendadas
1. Verificar si el servidor tiene autoscale: si lo tiene, ampliar vCPU (`scale_cpu`, máximo +4) es la primera opción.
2. Si la causa no es evidente (proceso descontrolado, fuga), escalar a la guardia (`escalate`) con métricas adjuntas.
3. Nunca reiniciar servicios de forma autónoma en producción con criticidad alta: requiere aprobación humana.

## Criterios de aprobación
Severidad critical en producción o servidor de criticidad alta requiere aprobación humana antes de ejecutar cambios.

## Incidentes de referencia
INC-014 (resuelto con +2 vCPU), INC-021 (requirió hotfix y escalamiento).
