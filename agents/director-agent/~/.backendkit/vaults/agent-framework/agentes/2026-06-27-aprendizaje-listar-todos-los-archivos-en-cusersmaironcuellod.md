---
title: "Aprendizaje — Listar TODOS los archivos en C:\Users\mairon.cuello\developm"
author: "agent/orchestrator"
date: 2026-06-27
tags: ["área/orquestador", "función/aprendizaje", "auto-consolidado"]
description: "Run run-1782519690833-hjr4t6: Listar TODOS los archivos en C:\Users\mairon.cuello\development\agent-cloud\src, incluido el conteni"
---

- **Pattern: Consistent DTO structure for CRUD modules.** The `agents` and `projects` modules follow the same pattern: a `dto/` folder with `create-*.dto.ts`, `update-*.dto.ts`, and optionally `query-*.dto.ts` for pagination. The `index.ts` barrel file re-exports only the DTOs needed externally (e.g., `CreateAgentDto`). This pattern should be replicated for any new entity module.

- **Pattern: Module imports and exports.** Both `AgentsModule` and `ProjectsModule` import their own `TypeOrmModule.forFeature([Entity])` (or other required modules like `AuthModule`, `DockerModule`), register the controller and service, and export the service for use in other modules. This ensures dependency injection and reusability.

- **Edge case: Partial updates via `UpdateProjectDto`.** The `update-project.dto.ts` makes all fields optional (`@IsOptional()`) and uses the same validation decorators as the create DTO. This allows partial updates without requiring all fields, which is a common REST API pattern. The service should handle merging only provided fields.