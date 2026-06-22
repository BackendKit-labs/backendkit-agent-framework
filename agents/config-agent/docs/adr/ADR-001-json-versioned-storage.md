# ADR-001: Archivos JSON versionados como almacenamiento

**Status:** Aceptado  
**Fecha:** 2026-06-19  
**Contexto:** Auditoría QA — H9 (hallazgo Low)

---

## Contexto

Necesitamos persistir configuraciones con historial de versiones, soportar diff, restore y trazabilidad. El volumen esperado es bajo (decenas de agentes, cientos de versiones). No queremos depender de una base de datos externa para mantener la autonomía del agente.

## Decisión

Usar archivos JSON individuales por versión en `~/.backendkit/config/agents/{agent_id}/v{N}__{date}_{message}.json`, con symlink "current" apuntando a la versión activa.

### Formato de archivo

```json
{
  "version": "v3",
  "createdAt": "2026-06-19T10:30:00.000Z",
  "message": "update SMTP_HOST",
  "agent_id": "notification-agent",
  "config": { "SMTP_HOST": "smtp.gmail.com", "SMTP_PORT": 587 },
  "changes": [{ "key": "SMTP_HOST", "action": "updated", "previousVersion": "v2" }],
  "checksum": "sha256hex..."
}
```

### Mecanismo "current"

- En Linux/Mac: symlink del SO (`current → v3__2026-06-19_update_SMTP_HOST.json`)
- En Windows: archivo `current` con el nombre de la versión (fallback cuando symlink no está disponible)

## Consecuencias

- **Positivo:** Sin dependencias de base de datos. Fácil de inspeccionar y depurar.
- **Positivo:** Versiones inmutables por diseño (nadie modifica un archivo después de creado).
- **Positivo:** Backup = copiar directorio. Restore = copiar archivo.
- **Negativo:** Sin transacciones atómicas (si el proceso falla a mitad de escritura, el archivo queda incompleto). Mitigación: escribir a archivo temporal + rename.
- **Negativo:** Windows no soporta symlinks fácilmente → alternativa con archivo `current.txt`.

## Referencias

- Implementación: `src/storage/versionedStore.ts`
- Hallazgo QA: H9
