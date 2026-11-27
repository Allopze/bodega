import type { CatalogSparePart, MantCatalog } from "../contracts"
import { nameKey } from "../normalize"

/**
 * Buscador de repuestos del catálogo para «Pedir repuestos» (ADR mantención 0001, R15). Todo local: el teléfono ya bajó la
 * lista (`MantCatalog.spareParts`) y filtra sin red, con o sin señal. Puro y sin React: la pantalla sólo pinta el resultado.
 */

/** Cuántas coincidencias se muestran de una vez: en un teléfono con el teclado arriba caben pocas. */
export const SPARE_PART_RESULTS = 6
/** Con menos letras casi todo coincide: no se busca. */
export const SPARE_PART_MIN_QUERY = 2

/** Los repuestos del catálogo, ordenados por nombre; un catálogo antiguo no los trae y la app ofrece sólo texto libre. */
export function catalogSpareParts(catalog: MantCatalog | null | undefined): readonly CatalogSparePart[] {
  return catalog?.spareParts ?? []
}

export interface SparePartIndex {
  readonly entries: ReadonlyArray<IndexEntry>
  /** Para volver del `productId` de una línea al repuesto elegido. */
  readonly byId: ReadonlyMap<string, CatalogSparePart>
}

interface IndexEntry {
  part: CatalogSparePart
  name: string
  sku: string
  partNumber: string
  /** Nombre, SKU y N° de parte juntos, normalizados. */
  all: string
  /** Lo mismo sin separadores: «1R-0750», «1R 0750» y «1R0750» son el mismo N° de parte. */
  compact: string
}

const compact = (value: string): string => value.replace(/[^a-z0-9]/g, "")

/** Normaliza una vez cada repuesto (tildes, mayúsculas, espacios) para que cada tecla sólo compare textos. */
export function buildSparePartIndex(parts: readonly CatalogSparePart[]): SparePartIndex {
  const entries = parts.map((part): IndexEntry => {
    const name = nameKey(part.name)
    const sku = nameKey(part.sku)
    const partNumber = nameKey(part.partNumber ?? "")
    const all = [name, sku, partNumber].filter(Boolean).join(" ")
    return { part, name, sku, partNumber, all, compact: compact(all) }
  })
  return { entries, byId: new Map(parts.map((part) => [part.id, part])) }
}

/**
 * Qué tan bien calza una entrada con lo escrito (menor = mejor), o `null` si no calza. Cada palabra escrita tiene que estar
 * en algún lado (nombre, SKU o N° de parte, sin importar el orden). Primero el código exacto, luego los que EMPIEZAN con
 * lo escrito, luego los que lo traen al comienzo de una palabra y al final los que sólo lo contienen.
 */
function rank(entry: IndexEntry, key: string, tokens: readonly string[]): number | null {
  for (const token of tokens) {
    const squeezed = compact(token)
    if (!entry.all.includes(token) && !(squeezed.length >= 3 && entry.compact.includes(squeezed))) return null
  }
  const squeezedKey = compact(key)
  if (entry.sku === key || entry.partNumber === key || (squeezedKey.length >= 3 && (compact(entry.sku) === squeezedKey || compact(entry.partNumber) === squeezedKey))) return 0
  if (entry.name.startsWith(key) || entry.sku.startsWith(key) || entry.partNumber.startsWith(key)) return 1
  if (tokens.every((token) => entry.all.startsWith(token) || entry.all.includes(` ${token}`))) return 2
  return 3
}

/**
 * Las mejores coincidencias para lo que se está escribiendo, normalizando tildes, mayúsculas y espacios (la misma clave
 * que usa el resto de la app: «Rodamiento» = «rodamiento» = «RODAMIENTO», «válvula» = «valvula»). Por debajo de
 * `SPARE_PART_MIN_QUERY` letras no devuelve nada. `total` es cuántos calzan en total, aunque sólo se devuelvan `limit`.
 */
export function searchSpareParts(index: SparePartIndex, query: string, limit = SPARE_PART_RESULTS): { results: CatalogSparePart[]; total: number } {
  const key = nameKey(query)
  if (key.length < SPARE_PART_MIN_QUERY || index.entries.length === 0) return { results: [], total: 0 }
  const tokens = key.split(" ")
  const ranked: Array<{ entry: IndexEntry; score: number }> = []
  for (const entry of index.entries) {
    const score = rank(entry, key, tokens)
    if (score !== null) ranked.push({ entry, score })
  }
  // Empate: por nombre, y el catálogo ya viene ordenado por nombre e id (el sort es estable).
  ranked.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name, "es"))
  return { results: ranked.slice(0, limit).map(({ entry }) => entry.part), total: ranked.length }
}

/** Lo que el repuesto elegido rellena en la línea: nombre como descripción, unidad y N° de parte, y su id. */
export interface SparePartFill {
  productId: string
  description: string
  unit: string
  partNumber: string
}

export function fillFromSparePart(part: CatalogSparePart): SparePartFill {
  return { productId: part.id, description: part.name, unit: part.unit, partNumber: part.partNumber ?? "" }
}

/** «SKU · N° de parte» del repuesto, para la segunda línea de cada resultado y el aviso de lo elegido. */
export function sparePartCodes(part: CatalogSparePart): string {
  return part.partNumber ? `${part.sku} · N° ${part.partNumber}` : part.sku
}
