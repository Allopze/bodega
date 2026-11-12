import ExcelJS from "exceljs"
import JSZip from "jszip"

/**
 * Carga tolerante de planillas `.xlsx` que suben las personas.
 *
 * Herramientas basadas en OpenXML SDK (.NET, varias de «exportar a Excel» y
 * asistentes) escriben el XML con el espacio de nombres prefijado —
 * `<x:worksheet xmlns:x="…/spreadsheetml/2006/main">`—. Es OOXML válido y Excel
 * lo abre, pero ExcelJS sólo entiende el espacio de nombres por defecto y falla
 * con «Cannot read properties of undefined (reading 'sheets')». Pasó con la
 * plantilla de equipos completada (2026-11-11): el importador la rechazaba como
 * si no fuera un Excel.
 *
 * Primero se intenta tal cual; si falla, se reescriben las partes XML sin el
 * prefijo y se vuelve a intentar. `null` = no es una planilla legible.
 */

const SPREADSHEETML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
/** Límites del reintento normalizado: una planilla de 2.000 filas no se acerca a esto. */
const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
const MAX_ENTRIES = 2000

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Quita el prefijo del espacio de nombres principal de una parte XML. Sin prefijo, la devuelve igual. */
export function unprefixSpreadsheetXml(xml: string): string {
  const text = xml.replace(/^﻿/, "")
  const prefixes = new Set<string>()
  const declaration = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${escapeRegExp(SPREADSHEETML)}"`, "g")
  for (const match of text.matchAll(declaration)) prefixes.add(match[1]!)
  let out = text
  for (const prefix of prefixes) {
    const p = escapeRegExp(prefix)
    out = out
      .replace(new RegExp(`<(/?)${p}:`, "g"), "<$1")
      .replace(new RegExp(`xmlns:${p}="${escapeRegExp(SPREADSHEETML)}"`, "g"), `xmlns="${SPREADSHEETML}"`)
  }
  return out
}

/**
 * OpenXML SDK también escribe las relaciones con ruta absoluta
 * (`Target="/xl/tables/table1.xml"`). ExcelJS las resuelve en el libro pero no
 * en las hojas (tablas, dibujos): se pasan a relativas a la carpeta de la parte.
 * El `_rels/.rels` de la raíz se deja igual.
 */
export function relativizeRelationshipTargets(relsPath: string, xml: string): string {
  const match = /^(.*)\/_rels\/[^/]+\.rels$/i.exec(relsPath)
  if (!match || !match[1]) return xml
  const partDir = match[1]
  return xml.replace(/Target="\/([^"]+)"/g, (_, target: string) => `Target="${relativePath(partDir, target)}"`)
}

/** `xl/worksheets` + `xl/tables/t1.xml` → `../tables/t1.xml` (sin `node:path`: el lint lo restringe en lib/). */
function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split("/").filter(Boolean)
  const target = to.split("/").filter(Boolean)
  let common = 0
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++
  return [...Array<string>(from.length - common).fill(".."), ...target.slice(common)].join("/")
}

/** Reescribe el paquete sin prefijos de espacio de nombres ni rutas absolutas. `null` si no es un zip. */
export async function normalizePrefixedXlsx(input: ArrayBuffer | Uint8Array): Promise<Buffer | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    return null
  }
  // Tope antes de inflar: un zip pequeño puede descomprimir a cientos de MB (revisión final).
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) return null
  let inflated = 0
  for (const entry of entries) inflated += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
  if (inflated > MAX_UNCOMPRESSED_BYTES) return null
  const out = new JSZip()
  for (const entry of entries) {
    if (entry.dir) continue
    const name = entry.name.replace(/^\/+/, "")
    if (/\.rels$/i.test(name)) out.file(name, relativizeRelationshipTargets(name, unprefixSpreadsheetXml(await entry.async("string"))))
    else if (/\.xml$/i.test(name)) out.file(name, unprefixSpreadsheetXml(await entry.async("string")))
    else out.file(name, await entry.async("uint8array"))
  }
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

/** Carga con ExcelJS y, si falla, reintenta con el paquete normalizado. `null` si ninguno sirve. */
export async function loadXlsxTolerant(input: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook | null> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const first = new ExcelJS.Workbook()
  try {
    await first.xlsx.load(Buffer.from(bytes) as never)
    return first
  } catch {
    // sigue con el paquete normalizado
  }
  const normalized = await normalizePrefixedXlsx(bytes)
  if (!normalized) return null
  const second = new ExcelJS.Workbook()
  try {
    await second.xlsx.load(normalized as never)
    return second
  } catch {
    return null
  }
}
