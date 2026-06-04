import type { Skill } from '@backendkit-labs/agent-core';

/**
 * Language-agnostic skills built into the framework.
 * These are always available regardless of project stack.
 */
export const GLOBAL_BUILTIN_SKILLS: Skill[] = [
    {
        name: 'conventional-commits',
        version: '1.0.0',
        description: 'Conventional Commits specification for any language or stack',
        scope: 'global',
        triggers: [
            'commit', 'conventional commit', 'commit message', 'mensaje de commit',
            'changelog', 'semantic versioning', 'semver', 'release notes',
        ],
        systemPromptAddition: `## Conventional Commits

Formato obligatorio para todos los commits:
\`<type>(<scope>): <description>\`

### Tipos
| Tipo | Cuando usarlo |
|---|---|
| feat | Nueva funcionalidad |
| fix | Correccion de bug |
| refactor | Refactor sin cambio de comportamiento |
| test | Tests nuevos o modificados |
| docs | Solo documentacion |
| chore | Mantenimiento, dependencias, config |
| perf | Mejora de rendimiento |
| ci | Cambios en CI/CD |

### Reglas
- Descripcion en imperativo: "add", "fix", "update" â€” no "added", "fixed"
- Sin punto al final
- Breaking change: agrega "!" antes de ":" o pie de pagina "BREAKING CHANGE:"
- Scope opcional: nombre del modulo o dominio afectado`,
    },
    {
        name: 'code-review',
        version: '1.0.0',
        description: 'Code review checklist and best practices for any language',
        scope: 'global',
        triggers: [
            'code review', 'revisar codigo', 'revisiÃ³n de codigo', 'pull request',
            'pr review', 'review checklist', 'revisiÃ³n', 'code quality',
        ],
        systemPromptAddition: `## Code Review

Al revisar codigo, evalua en este orden:

### 1. Correctitud
- El codigo hace lo que dice que hace?
- Maneja edge cases y errores?
- Hay race conditions o problemas de concurrencia?

### 2. Legibilidad
- Los nombres son descriptivos y consistentes?
- La logica es facil de seguir sin comentarios?
- Las funciones hacen una sola cosa?

### 3. Mantenibilidad
- Hay duplicacion que deberia extraerse?
- Las abstracciones son las correctas (ni muy pocas ni demasiadas)?
- Los tests cubren el comportamiento, no la implementacion?

### 4. Seguridad
- Hay inputs del usuario sin validar?
- Se expone informacion sensible en logs o errores?
- Las dependencias tienen vulnerabilidades conocidas?

### 5. Rendimiento
- Hay N+1 queries o loops innecesarios?
- Se cachea lo que deberia cachearse?
- El impacto en memoria y CPU es razonable?

Formato de feedback: especifica archivo, linea y razon. Separa bloqueantes de sugerencias.`,
    },
    {
        name: 'tdd',
        version: '1.0.0',
        description: 'Test-Driven Development discipline for any language',
        scope: 'global',
        triggers: [
            'tdd', 'test driven', 'test-driven development', 'red green refactor',
            'escribir tests primero', 'tests antes', 'coverage', 'cobertura',
        ],
        systemPromptAddition: `## Test-Driven Development

### Ciclo obligatorio: Red â†’ Green â†’ Refactor
1. **Red** â€” escribe el test que falla primero. El test define el comportamiento esperado.
2. **Green** â€” escribe el minimo codigo para que el test pase. No sobredisenes.
3. **Refactor** â€” mejora el codigo sin cambiar el comportamiento. Los tests deben seguir pasando.

### Que testear
- Comportamiento observable, no implementacion interna
- Edge cases: nulo, vacio, maximo, minimo
- Casos de error: que pasa cuando algo falla

### Que NO testear
- Detalles de implementacion que pueden cambiar
- Librerias de terceros (confiar en sus propios tests)
- Codigo trivial sin logica de negocio

### Estructura de un buen test (AAA)
\`\`\`
// Arrange â€” preparar el estado inicial
// Act     â€” ejecutar la accion bajo prueba
// Assert  â€” verificar el resultado esperado
\`\`\`

### Reglas
- Un test = una assertion logica (puede tener varias lineas de expect)
- Nombre del test: describe QUE hace, no COMO lo hace
- Tests deben ser deterministicos: mismo input = mismo output siempre`,
    },
    {
        name: 'adr',
        version: '1.0.0',
        description: 'Architecture Decision Records â€” document significant design choices',
        scope: 'global',
        triggers: [
            'adr', 'architecture decision', 'decision de arquitectura', 'architectural record',
            'decision record', 'doc arquitectura', 'documentar decision',
        ],
        systemPromptAddition: `## Architecture Decision Records (ADR)

Usa este formato para documentar decisiones de arquitectura significativas.

### Cuando crear un ADR
- Cambias una tecnologia o framework
- Adoptas un patron arquitectonico
- Rechazas una alternativa que alguien podria proponer en el futuro
- La decision tiene consecuencias a largo plazo o es dificil de revertir

### Formato
\`\`\`markdown
# ADR-{numero}: {titulo breve}

**Fecha:** YYYY-MM-DD
**Estado:** Propuesto | Aceptado | Rechazado | Deprecado | Supersedido por ADR-{n}

## Contexto
Por que necesitamos tomar esta decision? Cual es el problema o necesidad?

## Decision
Que decidimos hacer?

## Consecuencias
### Positivas
- ...

### Negativas / Trade-offs
- ...

## Alternativas consideradas
- **{Alternativa A}** â€” por que fue descartada
- **{Alternativa B}** â€” por que fue descartada
\`\`\`

Guarda los ADRs en \`docs/adr/\` o \`architecture/decisions/\`.`,
    },
    {
        name: 'security-checklist',
        version: '1.0.0',
        description: 'OWASP-based security checklist for any stack',
        scope: 'global',
        triggers: [
            'seguridad', 'security', 'owasp', 'vulnerabilidad', 'vulnerability',
            'pentest', 'auditoria de seguridad', 'security audit', 'hardening',
            'sql injection', 'xss', 'csrf', 'autenticacion', 'autorizacion',
        ],
        systemPromptAddition: `## Security Checklist (OWASP Top 10)

Al revisar o implementar codigo, verifica:

### Inputs y validacion
- Todo input del usuario se valida y sanitiza antes de usarse
- Nunca se construyen queries con concatenacion de strings (usar parametrized queries)
- Los archivos subidos se validan en tipo, tamanio y contenido

### Autenticacion y sesiones
- Passwords hasheados con bcrypt/argon2/scrypt (nunca MD5/SHA1)
- Tokens JWT validados en firma, expiracion y claims
- Sesiones invalidadas al logout

### Autorizacion
- Cada endpoint verifica permisos, no solo autenticacion
- IDOR: no se puede acceder a recursos de otro usuario cambiando el ID

### Datos sensibles
- Secretos en variables de entorno, nunca en codigo o logs
- HTTPS obligatorio en produccion
- Datos sensibles no se logean (tokens, passwords, PII)

### Headers y configuracion
- CORS configurado restrictivamente (no "*" en produccion)
- CSP, X-Frame-Options, HSTS configurados
- Dependencias sin vulnerabilidades conocidas (npm audit, pip audit)

### Errores
- Mensajes de error genericos al cliente (no exponer stack traces)
- Errores detallados solo en logs internos`,
    },
];

