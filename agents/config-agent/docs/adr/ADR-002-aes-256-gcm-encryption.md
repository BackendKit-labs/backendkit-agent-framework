# ADR-002: Encriptación AES-256-GCM con crypto nativo

**Status:** Aceptado  
**Fecha:** 2026-06-19  
**Contexto:** Auditoría QA — H9 (hallazgo Low), H2 (hallazgo High), H4 (hallazgo Medium)

---

## Contexto

Los secrets (tokens, passwords, API keys) deben almacenarse encriptados en disco. Necesitamos un mecanismo que no dependa de servicios externos (HSM, KMS) para mantener la autonomía del agente.

## Decisión

Usar `crypto.createCipheriv` con AES-256-GCM. La master key se obtiene de la env var `CONFIG_MASTER_KEY`. Si no está definida, se genera automáticamente al primer startup y se guarda en `~/.backendkit/config/secrets/master.key` con una advertencia en logs.

### Formato de secreto encriptado

```
iv(hex):tag(hex):encrypted(hex)
```

Ejemplo: `a1b2c3...:d4e5f6...:7g8h9i...`

### Manejo de master key

1. **Producción:** Usar `CONFIG_MASTER_KEY` (env var). No debe persistirse en disco.
2. **Desarrollo/local:** Si no hay env var, se genera y guarda en `master.key` con log warning.
3. **Seguridad:** Si se usa master.key en disco, aplicar derivación PBKDF2 con salt antes de usar como clave AES.

## Consecuencias

- **Positivo:** Sin dependencias externas para seguridad crítica.
- **Positivo:** GCM proporciona autenticación (detecta manipulación de datos encriptados).
- **Negativo:** Si se pierde la master key, todos los secrets son irrecuperables.
- **Negativo:** crypto-js sería necesario para desencriptar desde browser (Fase 2 UI web).

## Referencias

- Implementación: `src/storage/secretStore.ts`
- Hallazgos QA: H2 (master key en disco), H4 (PBKDF2), H9 (ADR faltante)
