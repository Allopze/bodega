/**
 * Número tecleado por un operador en terreno. La coma es el decimal que ofrece
 * el teclado en es-CL; el punto también se acepta como decimal. Si vienen
 * ambos, el punto es separador de miles ("12.345,6"). Devuelve `null` si no es
 * un número (para no inventar un 0 de un campo mal escrito).
 */
export function parseFieldNumber(raw: string): number | null {
  const text = raw.replace(/\s/g, "")
  if (!text || !/^\d[\d.,]*$/.test(text)) return null
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text
  if ((normalized.match(/\./g) ?? []).length > 1) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}
