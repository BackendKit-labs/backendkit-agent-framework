# QA Report — Phase 1: Core Engine Tests

**Proyecto:** finance-agent
**Fecha:** 2024-07-15
**Agente:** QA Specialist
**Veredicto:** ❌ NO GO

## Criterios Funcionales

| ID | Criterio | Resultado | Evidencia |
|----|----------|-----------|-----------|
| C1 | `tests/core/engine.test.ts` existe con Jest | ❌ | El archivo `tests/core/engine.test.ts` no existe en el proyecto. No se encontró en la estructura de directorios. |
| C2 | `createEngine()` devuelve engine con provider `deepseek` | ❌ | No hay test implementado que verifique esta condición. |
| C3 | `createEngine()` devuelve engine con vault path `~/.backendkit/vaults/finance-agent` | ❌ | No hay test implementado que verifique esta condición. |
| C4 | `createEngine()` no lanza errores con config válida | ❌ | No hay test implementado que verifique esta condición. |
| C5 | `createEngine()` lanza error si falta provider | ❌ | No hay test implementado que verifique esta condición. |
| C6 | Usar mocks para deepseek | ❌ | No hay test implementado que utilice mocks para deepseek. |

## Cumplimiento de ADRs

| ADR | Estado | Evidencia |
|-----|--------|-----------|
| ADR-001 (Estructura de proyecto) | ⚠️ | La estructura del proyecto existe parcialmente, pero falta el directorio `tests/` y el archivo de test solicitado. |
| ADR-002 (Engine con agent-enterprise) | ✅ | `src/core/engine.ts` implementa `createEngine()` usando `@backendkit-labs/agent-enterprise` correctamente. |
| ADR-003 (Validación con Zod) | ✅ | `src/core/engine.ts` usa `EngineConfigSchema` con Zod para validar configuración. |

## Hallazgos

| Severidad | Descripción | Sugerencia |
|-----------|-------------|------------|
| 🔴 Alta | El archivo `tests/core/engine.test.ts` no existe. No se implementó ningún test para validar el engine. | Crear el archivo `tests/core/engine.test.ts` con Jest, implementando los 5 criterios especificados. |
| 🔴 Alta | No hay configuración de Jest en el proyecto (no se encontró `jest.config.js`, `jest.config.ts`, ni `package.json` con configuración de Jest). | Agregar configuración de Jest en `package.json` o crear `jest.config.ts` con los mocks necesarios. |
| 🟡 Media | El código de `src/core/engine.ts` está bien estructurado y es testeable, pero no hay tests que lo cubran. | Implementar tests unitarios que cubran: creación exitosa, validación de provider, validación de vault path, y manejo de errores. |

## Tests

- `npm test`: No se pudo ejecutar — no existe configuración de tests en el proyecto.
- Coverage: N/A — no hay tests implementados.

## Análisis del Código Existente

El archivo `src/core/engine.ts` está correctamente implementado:

1. **Provider deepseek**: El código fuerza `provider: 'deepseek'` en la configuración fusionada (línea 22).
2. **Vault path**: El default es `'~/.backendkit/vaults/finance-agent'` (línea 24).
3. **No lanza error con config válida**: Si se pasa `apiKey`, Zod valida correctamente y no lanza error.
4. **Lanza error si falta provider**: Aunque el código fuerza `provider: 'deepseek'` como default, si se intentara pasar un provider inválido, Zod lo rechazaría por el `z.literal('deepseek')`.

Sin embargo, **ninguno de estos comportamientos está verificado por tests automatizados**.

## Recomendación

Se requiere implementar el archivo `tests/core/engine.test.ts` con Jest, incluyendo:

```typescript
// tests/core/engine.test.ts
import { createEngine } from '../../src/core/engine';

// Mock de @backendkit-labs/agent-enterprise
jest.mock('@backendkit-labs/agent-enterprise', () => ({
  createAgent: jest.fn().mockReturnValue({
    provider: 'deepseek',
    vault: { path: '~/.backendkit/vaults/finance-agent' },
    // ... otros métodos mock
  }),
}));

describe('createEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debe devolver un engine con provider deepseek', () => {
    const engine = createEngine({ apiKey: 'test-key' });
    expect(engine.provider).toBe('deepseek');
  });

  it('debe devolver un engine con vault path por defecto', () => {
    const engine = createEngine({ apiKey: 'test-key' });
    expect(engine.vault.path).toBe('~/.backendkit/vaults/finance-agent');
  });

  it('no debe lanzar error con configuración válida', () => {
    expect(() => createEngine({ apiKey: 'test-key' })).not.toThrow();
  });

  it('debe lanzar error si falta provider (provider inválido)', () => {
    expect(() => createEngine({ apiKey: 'test-key', provider: 'invalid' as any })).toThrow();
  });

  it('debe usar mocks para deepseek', () => {
    const engine = createEngine({ apiKey: 'test-key' });
    expect(engine).toBeDefined();
    // Verificar que se usó el mock
    const { createAgent } = require('@backendkit-labs/agent-enterprise');
    expect(createAgent).toHaveBeenCalled();
  });
});