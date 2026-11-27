# Architecture Decision Records (ADR)

Decisiones de arquitectura del framework que son difíciles de revertir, rechazan una alternativa razonable o afectan a varios paquetes.

## Cuándo crear un ADR
- Cambiamos una tecnología o adoptamos un patrón arquitectónico.
- Rechazamos una alternativa que alguien podría proponer en el futuro.
- La decisión tiene consecuencias a largo plazo o es difícil de revertir.

## Formato
Un archivo por decisión: `NNNN-titulo-corto.md`, numeración correlativa de 4 dígitos, nunca se reutiliza un número.

```markdown
# ADR-NNNN: título breve

**Fecha:** YYYY-MM-DD
**Estado:** Propuesto | Aceptado | Rechazado | Deprecado | Supersedido por ADR-NNNN
**Spec:** enlace a la sección del spec que la implementa

## Contexto
## Decisión
## Consecuencias
### Positivas
### Negativas / trade-offs
## Alternativas consideradas
```

Un ADR aceptado no se edita para cambiar la decisión: se escribe uno nuevo que lo supersede.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-ejecucion-paralela-de-tool-calls.md) | Ejecución paralela de tool calls | Aceptado |
| [0002](0002-aborto-automatico-por-presupuesto.md) | Aborto automático por presupuesto | Aceptado |
| [0003](0003-salida-estructurada.md) | Salida estructurada | Aceptado |
| [0004](0004-cache-de-prompt-y-razonamiento-anthropic.md) | Caché de prompt y razonamiento en Anthropic | Aceptado |
| [0005](0005-unificacion-de-providers.md) | Unificación de providers LLM | Aceptado |
| [0006](0006-confianza-del-workspace.md) | Confianza del workspace para la capa de proyecto | Aceptado |
| [0007](0007-un-limite-declarado-debe-aplicarse.md) | Un límite declarado debe aplicarse | Aceptado |
| [0008](0008-core-define-contratos-verticales-y-apps-fuera.md) | Core define contratos; los verticales y las apps viven fuera | Aceptado |
| [0009](0009-lo-declarado-decide-el-efecto.md) | Lo que una tool declara decide su efecto; lo no declarado tiene efecto | Aceptado |
| [0010](0010-la-aprobacion-falla-cerrada.md) | La aprobación falla cerrada | Aceptado |
| [0011](0011-error-publico-y-error-interno.md) | Error público y error interno | Aceptado |

Specs que los agrupan: [SPEC-0001](../specs/SPEC-0001-agent-core-ola-1.md) (0001–0005), [SPEC-0009](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md) (0006–0007) y [SPEC-0013](../specs/SPEC-0013-framework-como-libreria-hoja-de-ruta.md) (0008). 0009–0011 salen de la revisión de código y la auditoría externa del 2026-11-26.
