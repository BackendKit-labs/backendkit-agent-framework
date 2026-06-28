---
title: "Aprendizaje — Corregir los tests fallando en agent-cloud. El proyecto está"
author: "agent/orchestrator"
date: 2026-06-27
tags: ["área/orquestador", "función/aprendizaje", "auto-consolidado"]
description: "Run run-1782520186076-wn7vzp: Corregir los tests fallando en agent-cloud. El proyecto está en C:\Users\mairon.cuello\development\a"
---

## Lecciones Reutilizables

### 1. Los archivos de test `.spec.ts` no se generan automáticamente con `nest g resource`
- **Descubrimiento:** Al generar un recurso con `nest g resource`, Nest CLI crea el módulo, controlador, servicio y DTOs, pero **no** genera automáticamente los archivos de test `.spec.ts`.
- **Acción requerida:** Los archivos de test deben crearse manualmente o copiarse de otro recurso similar.
- **Patrón:** Si un proyecto tiene tests para algunos recursos pero no para otros, es probable que los faltantes nunca se hayan creado, no que se hayan eliminado.

### 2. Los errores "Cannot find module" en tests suelen deberse a archivos `.spec.ts` incompletos o inexistentes
- **Causa común:** El archivo de test fue truncado durante la lectura (el agente solo leyó el inicio) o el archivo no existe en el sistema de archivos.
- **Síntoma:** El error muestra una ruta de import que parece correcta pero el módulo no se encuentra.
- **Solución:** Verificar que el archivo `.spec.ts` exista completamente y tenga todos los imports necesarios. Si el archivo no existe, crearlo desde cero basándose en la estructura de otros tests que sí funcionan.

### 3. Los tests de NestJS requieren que todos los módulos importados en el servicio estén mockeados en el `Test.createTestingModule`
- **Patrón:** Si `AgentsService` usa `Repository<Agent>` de TypeORM, el test debe proveer un mock con `getRepositoryToken(Agent)`.
- **Regla:** Cada dependencia inyectada en el servicio bajo prueba debe tener un provider mock correspondiente en el módulo de test.
- **Caso edge:** Si un servicio importa otro servicio (ej. `DirectorService` importa `AgentsService`), ambos deben estar mockeados en el test del servicio dependiente.

### 4. Los archivos de test pueden estar incompletos por truncamiento al leerlos con MCP
- **Problema:** Al leer archivos grandes con herramientas MCP, a veces solo se obtiene el inicio del archivo (ej. primeras 30 líneas).
- **Síntoma:** El archivo termina abruptamente con `...` o en medio de una línea de código.
- **Mitigación:** Siempre verificar que el contenido leído esté completo (debe terminar con `});` o similar). Si está truncado, usar un método alternativo para leer el archivo completo (ej. `cat` en terminal o dividir en partes).