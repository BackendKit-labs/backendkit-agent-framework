---
title: "Runbook disco lleno en base de datos"
description: "Disco por encima del 90% en servidores de base de datos: escalar a DBA, no borrar de forma autónoma."
area: infra
tipo: runbook
tags: ["runbook", "disk", "base-de-datos", "área/infra"]
aplica_a: ["prod"]
source_ref: "politica P-03"
---

## Síntomas
Uso de disco superior al 90% en un servidor de base de datos; escrituras fallando o logs de transacciones creciendo.

## Acción recomendada
Escalar al DBA de guardia (`escalate`) con el volumen afectado y la tasa de crecimiento. No hay acción autónoma de limpieza: borrar archivos de un motor de base de datos puede causar pérdida de datos.

## Seguimiento
Abrir o actualizar el ticket (`open_ticket` / `update_ticket`) con el plan de limpieza y de ampliación de disco.

## Incidentes de referencia
INC-052 (escalado a DBA, limpieza de logs de transacciones).
