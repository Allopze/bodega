/**
 * Junta todos los strings de un objeto SQL de drizzle.
 *
 * Los mocks de `findFirst` responden sin mirar el WHERE, así que la única forma
 * de comprobar A QUÉ mira un filtro es inspeccionar el filtro mismo, sin
 * acoplarse a la representación interna de drizzle.
 */
export function collectStrings(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === "string") { out.push(value); return out }
  if (!value || typeof value !== "object" || seen.has(value)) return out
  seen.add(value)
  for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, seen, out)
  return out
}
