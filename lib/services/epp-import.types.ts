/**
 * Types, constants and pure helper functions for EPP import.
 *
 * Extracted from epp-import.ts so client components can import them without
 * pulling in the Node.js `postgres` driver via @/db.
 */
// ── Types ────────────────────────────────────────────────────────────────────

export type ImportSeverity = "info" | "warning" | "blocking"
export type ImportDecision = "pending" | "create" | "update" | "skip" | "blocked"
export interface EppAttribute { name: string; value: string }
export interface ImportCorrection { field: string; from: string | null; to: string | null; ruleId: string; confidence: number }
export interface NormalizedEppRow {
  sourceCode: string | null; name: string; canonicalName: string; description: string | null; supplierName: string | null; price: number | null
  categoryName: string; unitOfMeasure: string; attributes: EppAttribute[]; eppType: string | null; brand: string | null; model: string | null; material: string | null
  identityKey: string; issues: Array<{ severity: ImportSeverity; message: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const UNIT_ALIASES: Record<string, string> = { uni: "unidad", un: "unidad", unidad: "unidad", par: "par", pares: "par", caja: "caja", pack: "paquete", paquete: "paquete", set: "set", juego: "juego" }
export const COLOR_ALIASES: Record<string, string> = { blanco: "Blanco", negra: "Negro", negro: "Negro", azul: "Azul", "azul marino": "Azul marino", rojo: "Rojo", roja: "Rojo", amarillo: "Amarillo", amarilla: "Amarillo", verde: "Verde", gris: "Gris", claro: "Claro", transparente: "Transparente" }
export const EPP_TYPES = ["casco", "guante", "lente", "antiparra", "botin", "zapato", "chaleco", "mascarilla", "respirador", "arnes", "protector auditivo", "buzo", "traje", "pantalon", "chaqueta"] as const
export const VALID_UNITS = ["unidad", "par", "caja", "paquete", "set", "juego"] as const
export const VALID_COLORS = [...new Set(Object.values(COLOR_ALIASES))]

export const RULE_LABELS: Record<string, string> = {
  normalize_name: "Nombre estandarizado",
  normalize_unit: "Unidad convertida automaticamente",
  default_epp_category: "Categoria EPP asignada por defecto",
  extract_color_from_name: "Color detectado en el nombre del producto",
  extract_size_from_name: "Talla detectada en el nombre del producto",
  manual_review: "Corregido manualmente",
}

export const HEADER_ALIASES: Record<string, string> = {
  sku: "sourceCode", codigo: "sourceCode", cod: "sourceCode", "codigo interno": "sourceCode",
  nombre: "name", producto: "name", descripcion: "description", detalle: "description",
  proveedor: "supplierName", precio: "price", valor: "price", unidad: "unitOfMeasure", categoria: "categoryName",
  atributos: "attributes", atributo: "attributes", talla: "size", color: "color", marca: "brand", modelo: "model", material: "material", notas: "notes", nota: "notes",
}

import { toCode } from "@/lib/utils"
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
  catch { return { rows: [] as SourceRow[], headers: {} as Record<string, number>, sheetName: "", errors: ["El archivo no es un XLSX válido o está dañado."] } }
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

export function normalizeEppRow(source: Record<string, string>): NormalizedEppRow {
  const issues: NormalizedEppRow["issues"] = []
  const corrections: EppAttribute[] = parseNamedAttributes(source.attributes)
  const explicitColor = canonicalColor(source.color)
  const rawName = cleanText(source.name)
  let workingName = rawName
  const colorsInName = Object.keys(COLOR_ALIASES).filter((color) => new RegExp(`\\b${escapeRegex(color)}\\b`, "i").test(workingName))
  if (colorsInName.length > 1 && /\//.test(workingName)) issues.push({ severity: "blocking", message: "El nombre contiene colores alternativos incompatibles." })
  const detectedColor = colorsInName.length === 1 ? canonicalColor(colorsInName[0]) : null
  if (explicitColor && detectedColor && explicitColor !== detectedColor) issues.push({ severity: "blocking", message: "El color de la columna contradice el color del nombre." })
  const color = explicitColor ?? detectedColor
  if (color) {
    addAttribute(corrections, "Color", color)
    if (!explicitColor) workingName = removeToken(workingName, colorsInName[0]!)
  }
  const explicitSize = cleanText(source.size)
  const sizeMatch = explicitSize || (cleanText(source.model) ? null : extractSize(workingName))
  if (sizeMatch) {
    addAttribute(corrections, /^\d{2}$/.test(sizeMatch) ? "Talla calzado" : "Talla", normalizeSize(sizeMatch))
    if (!explicitSize) {
      workingName = cleanText(workingName.replace(new RegExp(`\\btalla\\s+${escapeRegex(sizeMatch)}\\b`, "i"), ""))
      workingName = removeToken(workingName, sizeMatch)
    }
  }
  const eppType = EPP_TYPES.find((type) => {
    const normalizedType = cleanText(type)
    return normalizedType && new RegExp(`\\b${escapeRegex(normalizedType)}\\b`, "i").test(workingName)
  }) ?? null
  if (!eppType) issues.push({ severity: "blocking", message: "No se pudo identificar un tipo de EPP en el nombre." })
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
  const normalized: NormalizedEppRow = { sourceCode: cleanText(source.sourceCode) ? toCode(cleanText(source.sourceCode)) : null, name: canonicalName, canonicalName, description: cleanText(source.description) || null, supplierName: cleanText(source.supplierName) || null, price, categoryName, unitOfMeasure: unitOfMeasure ?? "unidad", attributes: corrections, eppType, brand, model, material: material || null, identityKey: "", issues }
  normalized.identityKey = identityKey(normalized)
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

function canonicalColor(value: string | undefined) {
  return COLOR_ALIASES[normalizeKey(value ?? "")] ?? null
}

function extractSize(value: string) {
  return value.match(/\b(?:XS|S|M|L|XL|2XL|3XL|[3-5]\d)\b/i)?.[0] ?? null
}

function normalizeSize(value: string) { return value.toUpperCase() }

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
  return [normalizeKey(row.categoryName), normalizeKey(row.canonicalName), normalizeKey(row.brand ?? ""), normalizeKey(row.model ?? ""), ...row.attributes.map((attribute) => `${normalizeKey(attribute.name)}=${normalizeKey(attribute.value)}`).sort()].join("|")
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

export function findProductMatches(normalized: NormalizedEppRow, existing: Array<{ id: string; name: string; unitOfMeasure: string; productAttributes: Array<{ name: string; options: string | null }> }>) {
  return existing.map((product) => {
    let score = 0; const reasons: string[] = []
    if (normalizeKey(product.name) === normalizeKey(normalized.name)) { score += 70; reasons.push("Nombre canónico equivalente") }
    if (product.unitOfMeasure === normalized.unitOfMeasure) { score += 10; reasons.push("Unidad equivalente") }
    const attributes = product.productAttributes.map((attribute) => `${normalizeKey(attribute.name)}:${normalizeKey(attribute.options ?? "")}`)
    const sameAttributes = normalized.attributes.filter((attribute) => attributes.some((value) => value.includes(`${normalizeKey(attribute.name)}:${normalizeKey(attribute.value)}`))).length
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
  if (!source.size && normalized.attributes.some((attribute) => attribute.name.startsWith("Talla"))) add("size", null, normalized.attributes.find((attribute) => attribute.name.startsWith("Talla"))?.value ?? null, "extract_size_from_name", 85)
  return corrections
}
