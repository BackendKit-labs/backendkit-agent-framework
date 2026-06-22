/**
 * Valida que un agent_id sea seguro para usar en paths de archivos.
 * Solo permite caracteres alfanuméricos, guiones y underscores.
 * @throws Error si el id contiene caracteres no permitidos
 * @returns El id sanitizado (trim aplicado)
 */
export function sanitizeAgentId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('agent_id es requerido y debe ser un string');
  }

  const sanitized = id.trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error(
      `agent_id inválido: '${id}'. Solo se permiten caracteres alfanuméricos, guiones y underscores.`
    );
  }

  return sanitized;
}
