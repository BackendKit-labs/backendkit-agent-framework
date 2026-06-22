# ADR-003: Schema opcional con inferencia

**Status:** Aceptado  
**Fecha:** 2026-06-19  
**Contexto:** Auditoría QA — H9 (hallazgo Low)

---

## Contexto

La validación contra schema es más precisa, pero no todos los agentes tendrán schema registrado (especialmente al inicio). Necesitamos un mecanismo de validación que funcione siempre, incluso sin schema.

## Decisión

Si hay schema registrado en `~/.backendkit/config/schemas/{agent_id}.json`, validar contra él. Si no, inferir tipos desde los valores actuales de la configuración y validar solo que no estén vacíos.

### Flujo de validación

```
validate_config(agent_id)
  → ¿Hay schema registrado?
    → Sí: validar contra schema (tipos, required, formatos URL/select/pattern)
    → No: ¿Hay configuración actual?
      → Sí: inferir schema desde valores (inferer.ts)
      → No: devolver "no hay datos para validar"
```

### Inferencia de tipos

| Valor en config | Tipo inferido |
|----------------|---------------|
| `"string"` | `string` (o `url` si es URL válida, o `secret` si el key contiene token/password/key) |
| `123` | `number` |
| `true`/`false` | `boolean` |

## Consecuencias

- **Positivo:** La validación siempre funciona, incluso sin schema registrado.
- **Positivo:** El schema registrado tiene prioridad y permite validación más estricta (required, min/max, pattern, options).
- **Negativo:** La inferencia es limitada (no puede detectar campos requeridos faltantes ni formatos exactos).
- **Negativo:** La validación sin schema es menos estricta (solo verifica que no esté vacío).

## Referencias

- Implementación: `src/services/validator.ts`, `src/services/inferer.ts`
- Hallazgo QA: H9
