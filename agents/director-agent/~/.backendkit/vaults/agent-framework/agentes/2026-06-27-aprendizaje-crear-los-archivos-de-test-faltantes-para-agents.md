---
title: "Aprendizaje — Crear los archivos de test faltantes para Agents en agent-cl"
author: "agent/orchestrator"
date: 2026-06-27
tags: ["área/orquestador", "función/aprendizaje", "auto-consolidado"]
description: "Run run-1782519817278-g7ak29: Crear los archivos de test faltantes para Agents en agent-cloud en C:\Users\mairon.cuello\developmen"
---

## Reusable Learnings

### 1. **TypeORM Repository Mocking Pattern for NestJS Tests**
- Use `getRepositoryToken(Entity)` from `@nestjs/typeorm` to inject mocked repositories
- Mock repository methods with `jest.fn()` and chain `.mockResolvedValue()` or `.mockRejectedValue()`
- **Key discovery**: `findAndCount` returns `[entities[], number]` tuple, not a single object. Mock must return `[mockAgents, totalCount]`
- For `findOneBy`, mock returns single entity or `null` for not-found cases
- Always import `Repository` from `typeorm` and use `jest.Mocked<Repository<Entity>>` for type safety

### 2. **Controller Testing with Service Mocks**
- Create a mock object with all service methods as `jest.fn()` before module compilation
- Use `module.get<AgentsService>(AgentsService)` to access the mocked service
- **Pattern**: Mock service methods return resolved values, then verify controller delegates correctly
- For HTTP status codes, use `@nestjs/common` `HttpStatus` enum or check response structure

### 3. **Common Test Setup Pitfalls**
- **Missing imports**: `@nestjs/testing` `Test` and `TestingModule` must be imported
- **Circular dependencies**: If entities have relations, mock them or use `jest.mock()` for related modules
- **DTO validation**: Tests may fail if DTOs have decorators that require class-validator/class-transformer - mock or provide these modules
- **Entity constructor**: If entity has constructor logic, create mock entities with plain objects instead of `new Entity()`
- **Path resolution**: Use absolute paths from project root or verify relative paths match actual file structure

### 4. **Edge Case: `findAndCount` with Pagination**
- The `QueryAgentDto` may have `page` and `limit` properties that affect the query
- Mock should verify that `findAndCount` is called with correct `skip` and `take` values
- **Non-obvious**: TypeORM's `findAndCount` ignores `skip`/`take` if `pagination` is disabled globally - check project config

### 5. **Test Execution Verification**
- Run `npm test` with `-- --verbose` flag to see individual test results
- If tests fail due to missing dependencies, check `package.json` for `@nestjs/testing`, `jest`, `ts-jest`
- **Common failure**: `Cannot find module` errors - verify file paths and that test files are in `src/` directory
- Use `jest --clearCache` if tests behave inconsistently after file changes