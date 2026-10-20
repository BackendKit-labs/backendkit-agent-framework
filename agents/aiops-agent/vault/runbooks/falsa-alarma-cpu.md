---
title: "Runbook falsa alarma de CPU"
description: "Cómo identificar picos transitorios de CPU (backups, batch) y cerrar la alerta sin acción."
area: infra
tipo: runbook
tags: ["runbook", "cpu", "falsa-alarma", "área/infra"]
aplica_a: ["prod", "stg", "dev"]
source_ref: "politica P-05"
---

## Cómo reconocerla
La alerta de CPU se disparó pero el estado actual del servidor es `ok` y la CPU está por debajo del 80%. Suele coincidir con backups nocturnos o tareas batch.

## Acción recomendada
`no_action`: dejar constancia en el log y no escalar capacidad. No ampliar vCPU si la CPU actual es menor al 80% (P-06).

## Cuándo no aplicar
Si el servidor está degradado o caído, o la CPU sigue alta, no es una falsa alarma: tratar como saturación.

## Incidentes de referencia
INC-033 (pico breve durante backup, autorrecuperado).
