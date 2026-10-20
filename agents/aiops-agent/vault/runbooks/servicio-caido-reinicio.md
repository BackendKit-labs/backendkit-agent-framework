---
title: "Runbook servicio caído y reinicio"
description: "Reinicio de servicios caídos: autónomo en dev/stg, con aprobación en producción."
area: infra
tipo: runbook
tags: ["runbook", "service_down", "reinicio", "área/infra"]
aplica_a: ["prod", "stg", "dev"]
source_ref: "politicas P-01, P-03"
---

## Entornos dev y stg
Un servicio caído se reinicia de forma autónoma (`restart_service`), sin aprobación (P-01).

## Producción
Reiniciar solo si la categoría no es CPU y la severidad es media o inferior sin aprobación (P-03). Con severidad alta o crítica, o servidor de criticidad alta, se requiere aprobación humana.

## Verificación posterior
Confirmar que el servicio vuelve a estado `ok` y revisar el log del despliegue reciente.

## Incidentes de referencia
INC-040 (servicio web en staging restaurado con reinicio), INC-058 (reinicio con ventana aprobada).
