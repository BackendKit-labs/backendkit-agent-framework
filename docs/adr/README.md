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

Spec que los agrupa: [SPEC-0001](../specs/SPEC-0001-agent-core-ola-1.md).
