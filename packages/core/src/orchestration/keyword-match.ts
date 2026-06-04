/**
 * @description Coincidencia de keywords compartida por los detectores del orquestador
 * (intent-detector, risk-scorer, domain-detector).
 *
 * Antes esta funcion estaba duplicada byte-a-byte en tres modulos, con riesgo de
 * deriva si uno cambiaba sin los otros (H-005). Es la unica fuente de verdad.
 */

/**
 * Verifica si un keyword aparece en el texto.
 * - Palabras simples: con word boundary (`\b`), para evitar coincidencias parciales.
 * - Frases (con espacios): como substring exacto, en minusculas.
 *
 * @param text    Texto donde buscar (se compara case-insensitive).
 * @param keyword Palabra o frase a buscar.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  if (!keyword.includes(' ')) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(keyword.toLowerCase());
}
