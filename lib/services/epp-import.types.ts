/**
 * Types, constants and pure helper functions for EPP import.
 *
 * Extracted from epp-import.ts so client components can import them without
 * pulling in the Node.js `postgres` driver via @/db.
 */
// ── Types ────────────────────────────────────────────────────────────────────

export type ImportSeverity = "info" | "warning" | "blocking"
export type ImportDecision = "pending" | "create" | "update" | "skip" | "blocked"
export interface EppAttribute { name: string; value: string; values?: string[]; sizeFamily?: string | null }
export interface ImportCorrection { field: string; from: string | null; to: string | null; ruleId: string; confidence: number }
export interface NormalizedEppRow {
  sourceCode: string | null; name: string; canonicalName: string; description: string | null; supplierName: string | null; price: number | null
  categoryName: string; unitOfMeasure: string; attributes: EppAttribute[]; eppType: string | null; brand: string | null; model: string | null; material: string | null
  identityKey: string; familyIdentityKey: string; issues: Array<{ severity: ImportSeverity; message: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const UNIT_ALIASES: Record<string, string> = {
  uni: "unidad", un: "unidad", unidad: "unidad", unidades: "unidad",
  par: "par", pares: "par",
  caja: "caja", cajas: "caja",
  pack: "paquete", paquete: "paquete", paquetes: "paquete",
  set: "set", juego: "juego",
  bolsa: "bolsa", bolsas: "bolsa",
  rollo: "rollo", rollos: "rollo",
  kit: "kit", kits: "kit",
  tarro: "tarro", tarros: "tarro",
  bidon: "bidon", bidones: "bidon",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  litro: "litro", litros: "litro", lt: "litro", l: "litro",
  metro: "metro", metros: "metro", mt: "metro", m: "metro",
  servicio: "servicio", servicios: "servicio",
  dosis: "dosis",
}
export const COLOR_ALIASES: Record<string, string> = { blanco: "Blanco", negra: "Negro", negro: "Negro", azul: "Azul", "azul marino": "Azul marino", rojo: "Rojo", roja: "Rojo", amarillo: "Amarillo", amarilla: "Amarillo", verde: "Verde", gris: "Gris", claro: "Claro", transparente: "Transparente" }
export const EPP_TYPES = [
  "casco", "guante", "lente", "antiparra", "botin", "zapato", "chaleco",
  "mascarilla", "respirador", "arnes", "protector auditivo", "buzo", "traje",
  "pantalon", "chaqueta",
  // Vocabulario que el catálogo real usa y este listado no cubría. Sin estos,
  // `normalizeEppRow` marcaba la fila con el issue bloqueante "No se pudo
  // identificar un tipo de EPP en el nombre" y la familia quedaba sin
  // clasificar, así que ninguna entrega suya acreditaba cobertura.
  "fono", "bota", "camisa", "polera", "blusa", "overol", "jardinera",
  "primera capa", "capa", "coleto", "gorro", "casquete", "barbiquejo",
  "visor", "mascara", "filtro",
  "otros",
] as const

/**
 * Maps this import's item-level vocabulary (EPP_TYPES, e.g. "casco") to the
 * `epp_types.code` body-part vocabulary ("cabeza") that Prevención's EPP
 * coverage tracking (`computeEppCoverageGaps`) actually joins on. `resolveFamily`
 * uses this to classify a family's `eppTypeId` at import time — without it,
 * every imported family stayed unclassified and no delivery of it ever
 * counted as coverage for anyone.
 */
export const EPP_TYPE_TO_BODY_PART_CODE: Partial<Record<(typeof EPP_TYPES)[number], string>> = {
  casco: "cabeza",
  lente: "ojos_cara",
  antiparra: "ojos_cara",
  "protector auditivo": "auditiva",
  mascarilla: "respiratoria",
  respirador: "respiratoria",
  guante: "manos",
  botin: "pies",
  zapato: "pies",
  arnes: "caidas",
  chaleco: "cuerpo",
  buzo: "cuerpo",
  traje: "cuerpo",
  pantalon: "cuerpo",
  chaqueta: "cuerpo",
  fono: "auditiva",
  bota: "pies",
  camisa: "cuerpo",
  polera: "cuerpo",
  blusa: "cuerpo",
  overol: "cuerpo",
  jardinera: "cuerpo",
  "primera capa": "cuerpo",
  capa: "cuerpo",
  coleto: "cuerpo",
  gorro: "cabeza",
  casquete: "cabeza",
  barbiquejo: "cabeza",
  visor: "ojos_cara",
  mascara: "ojos_cara",
  filtro: "respiratoria",
}

/**
 * Familia de talla (`lib/products/size-catalog.ts`) que corresponde al
 * vocabulario de ítem de este importador. Gemelo de
 * `EPP_TYPE_TO_BODY_PART_CODE`: uno traduce a la zona corporal con que
 * Prevención acredita, éste al eje por el que el ítem se sizea.
 *
 * Un tipo sin escala de talla —lentes, mascarillas, arnés, filtros— no entra
 * al mapa: su talla, si la trae la planilla, queda como el atributo genérico
 * `Talla` sin familia. Devolver `null` antes que adivinar es el mismo criterio
 * de `classifyEppTypeIdByName`.
 *
 * El pantalón va a `pantalon`, que desde la compilación de compras 2022-2026
 * usa la escala de letras igual que `ropa`: lo que distingue a las dos familias
 * es con qué campo del padrón cruzan (`size_bottom` contra `size_top`), no la
 * escala. Un trabajador puede ser L arriba y XL abajo.
 *
 * Las prendas de una pieza —jardinera, overol, buzo, traje, capa— se quedan en
 * `ropa`: visten el torso completo, así que la talla de arriba es la
 * referencia. Nota: «Traje PU Verde Activex Pantalón» infiere `traje` y no
 * `pantalon`, así que la mitad inferior de un traje de dos piezas queda con la
 * talla de arriba. Es una limitación de `inferEppItemType`, no de este mapa.
 */
export const EPP_TYPE_TO_SIZE_FAMILY: Partial<Record<(typeof EPP_TYPES)[number], string>> = {
  guante: "guantes",
  botin: "calzado",
  zapato: "calzado",
  bota: "calzado",
  casco: "casco",
  casquete: "casco",
  gorro: "casco",
  chaleco: "ropa",
  buzo: "ropa",
  traje: "ropa",
  pantalon: "pantalon",
  chaqueta: "ropa",
  camisa: "ropa",
  polera: "ropa",
  blusa: "ropa",
  overol: "ropa",
  jardinera: "ropa",
  "primera capa": "ropa",
  capa: "ropa",
  coleto: "ropa",
}

/** Familia de talla de un tipo de ítem, o `null` si ese ítem no se sizea. */
export function sizeFamilyForEppType(eppType: string | null): string | null {
  if (!eppType) return null
  return (EPP_TYPE_TO_SIZE_FAMILY as Record<string, string | undefined>)[eppType] ?? null
}

/** Códigos válidos de una familia. Estructura de `SizeFamilyOptions`. */
export interface SizeFamilyCodes {
  family: string
  attributeName: string
  codes: readonly string[]
}

export interface ResolvedSizeAttribute {
  /** Nombre del atributo a crear («Talla guantes»). */
  name: string
  /** Valores ya canonizados, en el orden de la planilla. */
  values: string[]
  /** Familia canónica a persistir en `product_attributes.size_family`. */
  sizeFamily: string | null
  issues: Array<{ severity: ImportSeverity; message: string }>
}

/**
 * Cómo se llama el atributo de talla de una fila, cómo se escriben sus valores
 * y a qué familia pertenece.
 *
 * Sustituye la heurística `/^\d{2}$/ ? "Talla calzado" : "Talla"` que estaba
 * duplicada en las dos ramas de `normalizeEppRow` y por la que ningún guante
 * recibía nunca `Talla guantes`, ningún casco `Talla casco`, y nada quedaba con
 * `size_family`.
 *
 * Una talla fuera de los códigos de su familia se acepta con advertencia y no
 * bloquea: las planillas de proveedor traen numeración que el catálogo no
 * declara (`9-10` de guante), y bloquear las dejaría inutilizables. La
 * advertencia es la señal de que alguien decida si esa talla se agrega a
 * `size_catalog` o se corrige.
 *
 * `familyOptions` viene de `size_catalog` cuando llama el servidor. Sin él cae
 * a la semilla, el mismo respaldo que `getSizeFamilyOptions` usa para una tabla
 * vacía: quedarse sin poder importar es peor que usar los valores por defecto.
 */
export function resolveSizeAttribute(
  rawValues: readonly string[],
  eppType: string | null,
  familyOptions?: readonly SizeFamilyCodes[],
): ResolvedSizeAttribute {
  // `normalizeSizeLabel` es el dueño único de la forma de una talla: un valor
  // que reduce a vacío —una celda con sólo puntuación— no es una talla, y
  // resucitarlo con otra regla reintroduciría la divergencia que el hallazgo
  // F-5 cerró.
  const values = [...new Set(
    rawValues
      .map((value) => normalizeSizeLabel(value))
      .filter(Boolean),
  )]
  const family = sizeFamilyForEppType(eppType)
  const definition = family
    ? (familyOptions ?? SIZE_FAMILIES).find((option) => option.family === family)
    : undefined

  if (!definition) return { name: "Talla", values, sizeFamily: null, issues: [] }

  const known = new Set(definition.codes.map((code) => normalizeSizeLabel(code)))
  const issues = values
    .filter((value) => !known.has(normalizeSizeLabel(value)))
    .map((value) => ({
      severity: "warning" as const,
      message: `La talla «${value}» no está en el catálogo de la familia ${definition.family}.`,
    }))

  return { name: definition.attributeName, values, sizeFamily: definition.family, issues }
}

/**
 * Accesorios cuyo nombre menciona el EPP al que se montan: "Fono ... p/casco"
 * es protección auditiva, no de cabeza. La mención se descarta antes de buscar
 * el tipo para que gane el ítem propio del producto y no la pieza citada.
 */
const MOUNTED_ON_MENTION = /(?:\bp\/\s*|\bpara\s+|\bporta\s+)(?:casco|visor|respirador|mascarilla|arnes)\b/gi

/**
 * Tipo de ítem que el nombre del producto declara, o `null` si no declara
 * ninguno — preferible a adivinar: `EPP_TYPE_TO_BODY_PART_CODE` traduce esto a
 * la zona corporal con que Prevención acredita al trabajador.
 */
export function inferEppItemType(name: string): (typeof EPP_TYPES)[number] | null {
  const searchable = cleanText(name).replace(MOUNTED_ON_MENTION, " ")
  return EPP_TYPES.find((type) => {
    const normalizedType = cleanText(type)
    // `s?` porque el catálogo nombra varios ítems en plural ("Guantes de cabritilla").
    return normalizedType && new RegExp(`\\b${escapeRegex(normalizedType)}s?\\b`, "i").test(searchable)
  }) ?? null
}
/**
 * Unidades que el importador acepta. Debe reflejar los códigos sembrados por
 * la migración `0228_seed_product_units` — ésa es la fuente de verdad; acá se
 * duplican porque este archivo es deliberadamente libre de `@/db` (lo importan
 * componentes cliente) y no puede consultar el catálogo.
 *
 * Con las 6 originales, una fila con `rollo`, `litro`, `kg` o `dosis` se
 * bloqueaba en la importación aunque fuera una unidad perfectamente válida.
 */
export const VALID_UNITS = [
  "unidad", "par", "caja", "paquete", "set", "juego",
  "bolsa", "rollo", "kit", "tarro", "bidon",
  "kg", "litro", "metro", "servicio", "dosis",
] as const
export const VALID_COLORS = [...new Set(Object.values(COLOR_ALIASES))]

export const RULE_LABELS: Record<string, string> = {
  normalize_name: "Nombre estandarizado",
  normalize_unit: "Unidad convertida automaticamente",
  default_epp_category: "Categoria EPP asignada por defecto",
  extract_color_from_name: "Color detectado en el nombre del producto",
  extract_size_from_name: "Talla detectada en el nombre del producto",
  canonicalize_size: "Talla estandarizada",
  assign_size_family: "Familia de talla asignada por el tipo de EPP",
  manual_review: "Corregido manualmente",
}

export const HEADER_ALIASES: Record<string, string> = {
  sku: "sourceCode", codigo: "sourceCode", cod: "sourceCode", "codigo interno": "sourceCode",
  nombre: "name", producto: "name", descripcion: "description", detalle: "description",
  proveedor: "supplierName", precio: "price", valor: "price", unidad: "unitOfMeasure", categoria: "categoryName",
  atributos: "attributes", atributo: "attributes", talla: "size", color: "color", marca: "brand", modelo: "model", material: "material", notas: "notes", nota: "notes",
}

import { toCode } from "@/lib/utils"
import { isSizeAttributeName, normalizeSizeLabel, parseSizeOptions } from "@/lib/products/product-size"
import { SIZE_FAMILIES } from "@/lib/products/size-catalog"
import ExcelJS from "exceljs"

function cellText(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object" && value) {
    const obj = value as Record<string, unknown>
    if (obj.result != null) return cellText(obj.result)
    if (obj.text != null) return String(obj.text).trim()
    if (Array.isArray(obj.richText)) return obj.richText.map((part: { text: string }) => part.text).join("").trim()
    return ""
  }
  return String(value).trim()
}

export async function parseEppWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer as never, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"] }) }
  catch { return { rows: [] as SourceRow[], headers: {} as Record<string, number>, sheetName: "", errors: ["El archivo no es un Excel válido o está dañado."] } }
  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [] as SourceRow[], headers: {} as Record<string, number>, sheetName: "", errors: ["El archivo no contiene hojas."] }
  if (sheet.rowCount > 5000) return { rows: [] as SourceRow[], headers: {} as Record<string, number>, sheetName: sheet.name, errors: ["El archivo supera el máximo de 5.000 filas."] }
  const headers = readHeaders(sheet.getRow(1).values)
  if (!headers.name) return { rows: [] as SourceRow[], headers, sheetName: sheet.name, errors: ["Falta una columna reconocible de Nombre o Producto."] }
  const rows: SourceRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values: Record<string, string> = {}
    for (const [field, index] of Object.entries(headers)) values[field] = cellText(row.getCell(index).value)
    if (Object.values(values).some(Boolean)) rows.push({ rowNumber, values })
  })
  return { rows, headers, sheetName: sheet.name, errors: [] }
}

export function normalizeEppRow(
  source: Record<string, string>,
  familyOptions?: readonly SizeFamilyCodes[],
): NormalizedEppRow {
  const issues: NormalizedEppRow["issues"] = []
  const corrections: EppAttribute[] = parseNamedAttributes(source.attributes)
  const rawColor = cleanText(source.color)
  const rawName = cleanText(source.name)
  let workingName = rawName

  // ── Multi-color: comma-separated values in the color column ──────────
  const multiColorRaw = rawColor ? rawColor.split(",").map((s) => s.trim()).filter(Boolean) : null
  if (multiColorRaw && multiColorRaw.length > 1) {
    const normalizedColors = multiColorRaw.map((c) => canonicalColor(c) ?? c).filter(Boolean)
    const existingColorAttr = findMatchingAttribute(corrections, "Color")
    if (existingColorAttr) {
      existingColorAttr.values = normalizedColors
      existingColorAttr.value = normalizedColors.join(", ")
    } else {
      corrections.push({ name: "Color", value: normalizedColors.join(", "), values: normalizedColors })
    }
  } else {
    const explicitColor = canonicalColor(rawColor)
    const colorsInName = Object.keys(COLOR_ALIASES).filter((color) => new RegExp(`\\b${escapeRegex(color)}\\b`, "i").test(workingName))
    if (colorsInName.length > 1 && /\//.test(workingName)) issues.push({ severity: "blocking", message: "El nombre contiene colores alternativos incompatibles." })
    const detectedColor = colorsInName.length === 1 ? canonicalColor(colorsInName[0]) : null
    if (explicitColor && detectedColor && explicitColor !== detectedColor) issues.push({ severity: "blocking", message: "El color de la columna contradice el color del nombre." })
    const color = explicitColor ?? detectedColor
    if (color) {
      addAttribute(corrections, "Color", color)
      if (!explicitColor) workingName = removeToken(workingName, colorsInName[0]!)
    }
  }
  // Antes del bloque de talla: `resolveSizeAttribute` necesita el tipo para
  // elegir la familia. Es seguro calcularlo aquí porque el ítem que el nombre
  // declara («guante») está presente tanto antes como después de quitarle la
  // talla, que es un código de una o dos posiciones.
  const eppType = inferEppItemType(workingName)
  if (!eppType) issues.push({ severity: "blocking", message: "No se pudo identificar un tipo de EPP en el nombre." })

  // La talla puede llegar por la columna `talla`, por la columna `atributos`
  // («Talla: M») o dentro del nombre. Se unifican para resolverlas juntas, pero
  // la limpieza del nombre depende sólo de la columna `talla`: cuando la talla
  // viene por ahí el nombre no la menciona, y `extractSize` podría confundir un
  // modelo con una talla.
  const columnSize = cleanText(source.size)
  const namedSize = corrections.find((attribute) => isSizeAttributeName(attribute.name))
  const declaredSize = columnSize
    || (namedSize ? (namedSize.values ?? [namedSize.value]).join(", ") : "")
  const rawSizes = declaredSize
    ? declaredSize.split(",").map((value) => value.trim()).filter(Boolean)
    : []

  if (!columnSize) {
    const sizeInName = cleanText(source.model) ? null : extractSize(workingName)
    if (sizeInName) {
      // La columna `atributos` manda sobre lo que diga el nombre; el token se
      // quita igual para que el nombre canónico no lleve la talla.
      if (rawSizes.length === 0) rawSizes.push(sizeInName)
      workingName = cleanText(workingName.replace(new RegExp(`\\btalla\\s+${escapeRegex(sizeInName)}\\b`, "i"), ""))
      workingName = removeToken(workingName, sizeInName)
    }
  }

  if (rawSizes.length > 0) {
    const resolved = resolveSizeAttribute(rawSizes, eppType, familyOptions)
    issues.push(...resolved.issues)
    upsertSizeAttribute(corrections, resolved)
  }
  const unitOfMeasure = normalizeUnit(source.unitOfMeasure)
  if (!unitOfMeasure) issues.push({ severity: "blocking", message: "La unidad de medida no es reconocida." })
  const price = parsePrice(source.price)
  if (source.price && price == null) issues.push({ severity: "blocking", message: "El precio no tiene un formato válido." })
  const material = cleanText(source.material) || extractMaterial(workingName)
  if (material) addAttribute(corrections, "Material", material)
  const brand = cleanText(source.brand) || null
  const model = cleanText(source.model) || null
  const canonicalName = titleCase(cleanText(workingName))
  if (!canonicalName) issues.push({ severity: "blocking", message: "El nombre queda vacío después de normalizarlo." })
  const categoryName = cleanText(source.categoryName) || "Elementos de Protección Personal"
  const normalized: NormalizedEppRow = { sourceCode: cleanText(source.sourceCode) ? toCode(cleanText(source.sourceCode)) : null, name: canonicalName, canonicalName, description: cleanText(source.description) || null, supplierName: cleanText(source.supplierName) || null, price, categoryName, unitOfMeasure: unitOfMeasure ?? "unidad", attributes: corrections, eppType, brand, model, material: material || null, identityKey: "", familyIdentityKey: "", issues }
  normalized.identityKey = identityKey(normalized)
  normalized.familyIdentityKey = buildEppFamilyIdentityKey(normalized)
  return normalized
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface SourceRow { rowNumber: number; values: Record<string, string> }

function readHeaders(values: unknown) {
  const headers: Record<string, number> = {}
  if (!Array.isArray(values)) return headers
  values.forEach((value, index) => {
    const field = HEADER_ALIASES[normalizeKey(cellText(value))]
    if (field && !headers[field]) headers[field] = index
  })
  return headers
}

function parseNamedAttributes(value: string | undefined) {
  return (value ?? "").split(/[;\n]/).map((item) => item.trim()).filter(Boolean).flatMap((item) => {
    const [name, ...rest] = item.split(":")
    const attributeValue = rest.join(":").trim()
    return name && attributeValue ? [{ name: titleCase(name.trim()), value: titleCase(attributeValue) }] : []
  })
}

function addAttribute(attributes: EppAttribute[], name: string, value: string) {
  if (!attributes.some((attribute) => normalizeKey(attribute.name) === normalizeKey(name))) attributes.push({ name, value })
}

function findMatchingAttribute(attributes: EppAttribute[], name: string): EppAttribute | undefined {
  return attributes.find((attribute) => normalizeKey(attribute.name) === normalizeKey(name))
}

/**
 * Deja exactamente un atributo de talla en la fila, con el nombre y la familia
 * que resolvió el catálogo.
 *
 * Reemplaza en vez de agregar porque la talla puede llegar por dos vías a la
 * vez: la columna `talla` y la columna `atributos` («Talla: M»). Sin esto, una
 * fila terminaba con `Talla` y `Talla guantes` a la vez, y el catálogo mostraba
 * la misma talla dos veces con nombres distintos.
 *
 * Una resolución sin valores —una celda que `normalizeSizeLabel` reduce a
 * vacío— deja la fila sin atributo de talla: quita el que hubiera y no pone
 * ninguno. Una talla que no se puede escribir no es una talla.
 */
function upsertSizeAttribute(attributes: EppAttribute[], resolved: ResolvedSizeAttribute) {
  for (let index = attributes.length - 1; index >= 0; index--) {
    if (isSizeAttributeName(attributes[index]!.name)) attributes.splice(index, 1)
  }
  if (resolved.values.length === 0) return
  attributes.push({
    name: resolved.name,
    value: resolved.values.join(", "),
    ...(resolved.values.length > 1 ? { values: resolved.values } : {}),
    sizeFamily: resolved.sizeFamily,
  })
}

function canonicalColor(value: string | undefined) {
  return COLOR_ALIASES[normalizeKey(value ?? "")] ?? null
}

function extractSize(value: string) {
  return value.match(/\b(?:XS|S|M|L|XL|2XL|3XL|4XL|[3-5]\d)\b/i)?.[0] ?? null
}

function extractMaterial(value: string) {
  const materials = ["nitrilo", "cabritilla", "cuero", "policarbonato", "algodon", "algodón"]
  const found = materials.find((material) => new RegExp(`\\b${material}\\b`, "i").test(value))
  return found ? titleCase(found) : null
}

function normalizeUnit(value: string | undefined) {
  return UNIT_ALIASES[normalizeKey(value ?? "")] ?? null
}

function parsePrice(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function identityKey(row: Pick<NormalizedEppRow, "canonicalName" | "categoryName" | "brand" | "model" | "attributes">) {
  // Exclude multi-value attributes (e.g., multiple tallas) from identity key
  // so they map to the same product
  const filteredAttrs = row.attributes.filter((attribute) => !attribute.values || attribute.values.length <= 1)
  return [normalizeKey(row.categoryName), normalizeKey(row.canonicalName), normalizeKey(row.brand ?? ""), normalizeKey(row.model ?? ""), ...filteredAttrs.map((attribute) => `${normalizeKey(attribute.name)}=${normalizeKey(attribute.value)}`).sort()].join("|")
}

export function buildEppFamilyIdentityKey(row: Pick<NormalizedEppRow, "canonicalName" | "categoryName" | "brand" | "model">) {
  return [normalizeKey(row.categoryName), normalizeKey(row.canonicalName), normalizeKey(row.brand ?? ""), normalizeKey(row.model ?? "")].join("|")
}

function cleanText(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
}

function normalizeKey(value: string) {
  return cleanText(value).toLocaleLowerCase("es-CL")
}

function titleCase(value: string) {
  return value.toLocaleLowerCase("es-CL").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-CL"))
}

function removeToken(value: string, token: string) {
  return cleanText(value.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, "i"), ""))
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Parse a JSON array of attribute options and check if a value is present. */
function attrOptionIncludes(options: string | null, value: string): boolean {
  if (!options) return false
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed) && parsed.some((opt: string) => normalizeKey(opt) === normalizeKey(value))) return true
  } catch { /* fall through to string includes */ }
  return normalizeKey(options).includes(normalizeKey(value))
}

/**
 * Una opción de talla equivale a un valor si coinciden ya canonizadas. Es lo
 * que permite que `XXXL` de la planilla cruce con `3XL` del catálogo, y lo que
 * evita que renombrar el atributo a `Talla guantes` le quite a la fila los
 * puntos de «atributos equivalentes» y la deje entrar como producto nuevo.
 */
function sizeOptionIncludes(options: string | null, value: string): boolean {
  const target = normalizeSizeLabel(value)
  return parseSizeOptions(options).some((option) => normalizeSizeLabel(option) === target)
}

export function findProductMatches(normalized: NormalizedEppRow, existing: Array<{ id: string; name: string; unitOfMeasure: string; productAttributes: Array<{ name: string; options: string | null }> }>) {
  return existing.map((product) => {
    let score = 0; const reasons: string[] = []
    if (normalizeKey(product.name) === normalizeKey(normalized.name)) { score += 70; reasons.push("Nombre canónico equivalente") }
    if (product.unitOfMeasure === normalized.unitOfMeasure) { score += 10; reasons.push("Unidad equivalente") }
    const sameAttributes = normalized.attributes.filter((attribute) => {
      const values = attribute.values ?? [attribute.value]
      const attributeIsSize = isSizeAttributeName(attribute.name)
      return values.some((value) => product.productAttributes.some((pa) => {
        // Dos atributos de talla son el mismo eje aunque se llamen distinto:
        // el catálogo tiene `Talla`, `Talla guantes` y `Talla calzado` para lo
        // que conceptualmente es una sola cosa.
        const sameAxis = attributeIsSize
          ? isSizeAttributeName(pa.name)
          : normalizeKey(pa.name) === normalizeKey(attribute.name)
        if (!sameAxis) return false
        return attributeIsSize
          ? sizeOptionIncludes(pa.options, value)
          : attrOptionIncludes(pa.options, value)
      }))
    }).length
    if (sameAttributes) { score += Math.min(20, sameAttributes * 10); reasons.push("Atributos equivalentes") }
    return { productId: product.id, score, reasons }
  }).filter((match) => match.score >= 70).sort((a, b) => b.score - a.score).slice(0, 3)
}

export function buildCorrections(source: Record<string, string>, normalized: NormalizedEppRow): ImportCorrection[] {
  const corrections: ImportCorrection[] = []
  const add = (field: string, from: string | null | undefined, to: string | null, ruleId: string, confidence = 100) => { if ((from ?? "") !== (to ?? "")) corrections.push({ field, from: from ?? null, to, ruleId, confidence }) }
  add("name", source.name, normalized.name, "normalize_name")
  add("unitOfMeasure", source.unitOfMeasure, normalized.unitOfMeasure, "normalize_unit")
  add("categoryName", source.categoryName, normalized.categoryName, "default_epp_category")
  if (!source.color && normalized.attributes.some((attribute) => attribute.name === "Color")) add("color", null, normalized.attributes.find((attribute) => attribute.name === "Color")?.value ?? null, "extract_color_from_name", 90)
  const sizeAttribute = normalized.attributes.find((attribute) => isSizeAttributeName(attribute.name))
  if (sizeAttribute) {
    // Sin columna `talla`, la talla se dedujo del nombre; con columna, lo que
    // se registra es la canonización de lo que el operador escribió.
    if (!source.size) add("size", null, sizeAttribute.value, "extract_size_from_name", 85)
    else add("size", source.size, sizeAttribute.value, "canonicalize_size", 95)
    if (sizeAttribute.sizeFamily) add("sizeFamily", null, sizeAttribute.sizeFamily, "assign_size_family", 90)
  }
  return corrections
}
