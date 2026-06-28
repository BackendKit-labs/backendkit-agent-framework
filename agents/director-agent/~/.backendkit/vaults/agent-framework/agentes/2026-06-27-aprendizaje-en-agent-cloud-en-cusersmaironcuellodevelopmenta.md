---
title: "Aprendizaje — En agent-cloud en C:\Users\mairon.cuello\development\agent-c"
author: "agent/orchestrator"
date: 2026-06-27
tags: ["área/orquestador", "función/aprendizaje", "auto-consolidado"]
description: "Run run-1782520282356-vp44n6: En agent-cloud en C:\Users\mairon.cuello\development\agent-cloud, los tests del director tienen impo"
---

- **Los archivos de test originales importaban `getRepositoryToken`, `Repository`, `Director`, `DirectorTask`, etc., que no existen en el proyecto.**  
  - La solución fue reescribir los tests usando solo `Test`, `TestingModule`, `DirectorService`, `AgentsService`, `Agent`, `AgentStatus`, `NotFoundException` y mockear `AgentsService` con `jest.Mocked<AgentsService>`.

- **Para mockear servicios en NestJS, usar `createMock` de `@nestjs/testing` es más limpio que crear mocks manuales.**  
  - En `director.controller.spec.ts` se usó `createMock<DirectorService>()` para generar un mock completo sin necesidad de definir cada método manualmente.

- **Los tests deben enfocarse en las funcionalidades reales del servicio/controlador, no en entidades que no existen.**  
  - Se eliminaron imports de entidades inexistentes (`Director`, `DirectorTask`) y se mockearon solo los métodos relevantes (`findAll`, `findOne`, `update` de `AgentsService`).