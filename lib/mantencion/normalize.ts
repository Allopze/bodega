/**
 * Normalización de nombres, patentes y folios (reglas 12, 16 y 17).
 */

/** Clave de comparación: minúsculas, sin tildes, espacios simples. «Cholguán» = «cholguan». */
export function nameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Nombre para mostrar: espacios simples y sin bordes; respeta tildes y mayúsculas tal como se escribió. */
export function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Regla 17: si el nombre escrito coincide normalizado con uno existente, se usa
 * el existente. Devuelve el existente o `null` si es realmente nuevo.
 */
export function findByNameKey<T extends { name: string }>(items: readonly T[], typed: string): T | null {
  const key = nameKey(typed)
  if (!key) return null
  return items.find((item) => nameKey(item.name) === key) ?? null
}

/** Patente antigua (`AB-1234`) y nueva (`BCDF-12`, sin vocales ni Ñ/M/N/Q). */
const PLATE_PATTERNS = [
  /^[A-Z]{2}-?\d{4}$/,
  /^[BCDFGHJKLPRSTVWXYZ]{4}-?\d{2}$/,
]

/**
 * Formatos especiales encontrados en el inventario. Al construir el seed
 * (INVENTARIO EQUIPOS 21-08-26) las únicas patentes fuera de los dos formatos
 * eran equipos sin patente que repetían su código (`TO-37`, `GR-08`); esos se
 * cargan como «Sin patente», así que hoy la lista está vacía. Un importador que
 * encuentre otro formato lo reporta como error con su fila, no lo inventa.
 */
export const SPECIAL_PLATE_PATTERNS: readonly RegExp[] = []

/**
 * Regla 16: mayúsculas, sin espacios ni puntos, con guion antes de los números.
 * `null` si después de limpiar no queda una forma letras+números.
 */
export function normalizePlate(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s.·_-]/g, "")
  const match = compact.match(/^([A-Z]+)(\d+)$/)
  return match ? `${match[1]}-${match[2]}` : null
}

export function isValidPlate(normalized: string): boolean {
  return PLATE_PATTERNS.some((pattern) => pattern.test(normalized))
    || SPECIAL_PLATE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export type PlateResult =
  | { ok: true; plate: string; noPlate: boolean }
  | { ok: false; message: string }

/**
 * Patente final de un equipo. Con «Sin patente» la patente guardada es el código
 * (la ficha la muestra igual al código, regla 16).
 */
export function resolvePlate(raw: string | null | undefined, code: string, noPlate: boolean): PlateResult {
  if (noPlate) return { ok: true, plate: normalizeCode(code), noPlate: true }
  const normalized = normalizePlate(raw ?? "")
  if (!normalized) return { ok: false, message: "Escribe la patente (por ejemplo, BCDF-12) o marca «Sin patente»." }
  if (!isValidPlate(normalized)) {
    return { ok: false, message: `«${normalized}» no es una patente válida. Usa el formato AB-1234 o BCDF-12, o marca «Sin patente».` }
  }
  return { ok: true, plate: normalized, noPlate: false }
}

/** Código interno del equipo: mayúsculas y sin espacios (`ka-135` → `KA-135`). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").trim()
}

/** Regla 12: `MP-BIO-0001`. */
export function formatFolio(kind: "P" | "C", worksiteFolioCode: string, sequence: number): string {
  return `M${kind}-${worksiteFolioCode}-${String(sequence).padStart(4, "0")}`
}

/**
 * Código de folio para una faena nueva: tres letras del nombre, evitando los ya
 * usados. «Flor del Laja» → `FLO`; si está tomado, prueba iniciales y luego
 * variantes hasta encontrar uno libre.
 */
export function deriveFolioCode(name: string, taken: ReadonlySet<string>): string {
  const letters = nameKey(name).replace(/[^a-z ]/g, "").toUpperCase()
  const words = letters.split(" ").filter(Boolean)
  const compact = words.join("")
  const candidates: string[] = []
  if (compact.length >= 3) candidates.push(compact.slice(0, 3))
  if (words.length >= 3) candidates.push(words.slice(0, 3).map((word) => word.slice(0, 1)).join(""))
  const [first = "", second = ""] = words
  if (words.length === 2 && second.length >= 2) candidates.push(`${first.slice(0, 1)}${second.slice(0, 2)}`)
  for (let i = 3; i < compact.length; i++) candidates.push(`${compact.slice(0, 2)}${compact[i]}`)
  for (const candidate of candidates) if (/^[A-Z]{3}$/.test(candidate) && !taken.has(candidate)) return candidate
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const initial = compact.slice(0, 1) || "F"
  for (const a of alphabet) for (const b of alphabet) {
    const candidate = `${initial}${a}${b}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("No quedan códigos de folio disponibles")
}
