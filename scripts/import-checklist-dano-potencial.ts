/**
 * Carga la calibración de daño potencial devuelta por Prevención al catálogo.
 *
 * Contraparte de `export-checklist-dano-potencial.ts`. Escribe `danoPotencial`
 * en los archivos `lib/sst/definitions/*-sections.ts`, que es el campo del que
 * dependen la prioridad y el plazo de la acción correctiva en PDTP y la
 * criticidad del hallazgo en el motor de inspecciones.
 *
 * Cuidados que justifican no hacerlo con un buscar/reemplazar simple:
 *   - los `id` de ítem colisionan entre archivos (hay varios `luces`), así que
 *     la resolución se hace por el archivo que el checklist realmente importa;
 *   - `observacion-seguridad-sections` lo comparten dos checklists, de modo que
 *     una calibración divergente para el mismo ítem se rechaza en vez de que
 *     gane la última fila leída;
 *   - la escritura es idempotente: reemplaza el valor si ya existe.
 *
 * Uso:  npx tsx scripts/import-checklist-dano-potencial.ts <archivo.xlsx>
 *       npx tsx scripts/import-checklist-dano-potencial.ts <archivo.xlsx> --dry-run
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { CHECKLIST_DEFINITIONS, isPersonEvaluationDefinition } from "@/lib/sst/definitions"

const VALID = new Set(["leve", "moderado", "grave", "fatal"])
const DEFINITIONS_DIR = path.resolve(process.cwd(), "lib/sst/definitions")

interface Row { code: string; sectionId: string; itemId: string; item: string; dano: string }

/**
 * Lector ZIP mínimo sobre `zlib`. El archivo devuelto por Prevención puede
 * venir re-guardado por otra herramienta y quedar sin `[Content_Types].xml`,
 * lo que hace fallar a exceljs. Leer las entradas directamente evita esa
 * fragilidad y evita sumar dependencias por un script de una vez.
 */
function readZipEntries(file: string): Map<string, string> {
  const buffer = fs.readFileSync(file)
  const entries = new Map<string, string>()

  // Se lee el directorio central y no las cabeceras locales: cuando el archivo
  // se genera en modo streaming, la cabecera local trae tamaño 0 y el valor
  // real vive en el descriptor posterior. El directorio central siempre lo
  // tiene, y es lo que usan las herramientas de escritorio al re-guardar.
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd === -1) throw new Error("El archivo no es un paquete OOXML legible.")

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    try {
      entries.set(name, (method === 0 ? raw : zlib.inflateRawSync(raw)).toString("utf8"))
    } catch { /* entrada ilegible: el llamador valida lo que necesita */ }

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
}

function readCalibration(file: string): Row[] {
  const entries = readZipEntries(file)
  const sheet = entries.get("xl/worksheets/sheet1.xml")
  if (!sheet) throw new Error("El archivo no contiene la hoja de calibración.")

  // Las etiquetas pueden venir con prefijo de namespace (`<x:row>`): un archivo
  // re-guardado por otra herramienta lo hace, y sin tolerarlo el importador
  // lee cero filas y parece que la planilla viniera vacía.
  const tag = (name: string) => `(?:\\w+:)?${name}`

  const shared: string[] = []
  const sharedXml = entries.get("xl/sharedStrings.xml")
  if (sharedXml) {
    for (const si of sharedXml.match(new RegExp(`<${tag("si")}[^>]*>[\\s\\S]*?<\\/${tag("si")}>`, "g")) ?? []) {
      shared.push(decodeXmlText((si.match(new RegExp(`<${tag("t")}[^>]*>([\\s\\S]*?)<\\/${tag("t")}>`, "g")) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, "")).join("")))
    }
  }

  const rows: Row[] = []
  const rowPattern = new RegExp(`<${tag("row")}[^>]*>[\\s\\S]*?<\\/${tag("row")}>`, "g")
  const cellPattern = new RegExp(`<${tag("c")}[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag("c")}>)`, "g")
  const valuePattern = new RegExp(`<${tag("v")}[^>]*>([\\s\\S]*?)<\\/${tag("v")}>`)

  for (const rowXml of sheet.match(rowPattern) ?? []) {
    if (Number(rowXml.match(/\sr="(\d+)"/)?.[1]) === 1) continue
    const cells: Record<string, string> = {}
    for (const cellXml of rowXml.match(cellPattern) ?? []) {
      const column = cellXml.match(/\sr="([A-Z]+)\d+"/)?.[1]
      const raw = cellXml.match(valuePattern)?.[1]
      if (!column || raw === undefined) continue
      cells[column] = /\st="s"/.test(cellXml) ? shared[Number(raw)] ?? "" : decodeXmlText(raw)
    }
    const dano = (cells.G ?? "").trim().toLowerCase()
    if (!dano) continue
    rows.push({ code: cells.B ?? "", sectionId: cells.D ?? "", itemId: cells.F ?? "", item: cells.E ?? "", dano })
  }
  return rows
}

/** Archivo de secciones que cada checklist realmente importa. */
function resolveSectionsFile(checklistCode: string): string {
  for (const entry of fs.readdirSync(DEFINITIONS_DIR)) {
    if (!entry.endsWith(".ts") || entry === "index.ts" || entry.endsWith("-sections.ts")) continue
    const source = fs.readFileSync(path.join(DEFINITIONS_DIR, entry), "utf8")
    if (!new RegExp(`code:\\s*'${checklistCode}'`).test(source)) continue
    const match = source.match(/from\s+'\.\/([\w-]+-sections)'/)
    if (!match) throw new Error(`${entry} no importa un archivo de secciones.`)
    return path.join(DEFINITIONS_DIR, `${match[1]}.ts`)
  }
  throw new Error(`No se encontró la definición del checklist ${checklistCode}.`)
}

/**
 * Inserta o reemplaza `danoPotencial` en TODAS las apariciones del ítem.
 *
 * Un archivo compartido por dos checklists repite el mismo `id` una vez por
 * checklist, así que parchear sólo la primera aparición dejaría la mitad sin
 * calibrar. Como la validación previa ya rechazó calibraciones divergentes,
 * aplicar el mismo valor a todas las apariciones es correcto.
 *
 * El anclaje avanza equilibrando llaves hasta cerrar el objeto del ítem, para
 * no invadir el siguiente.
 */
function applyToSource(source: string, itemId: string, dano: string): { source: string; occurrences: number } {
  const anchorText = `id: '${itemId}'`
  let occurrences = 0
  let searchFrom = 0

  for (;;) {
    const anchor = source.indexOf(anchorText, searchFrom)
    if (anchor === -1) break

    const start = source.lastIndexOf("{", anchor)
    let depth = 0
    let end = start
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1
      else if (source[i] === "}") {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }

    const block = source.slice(start, end + 1)
    const indent = (source.slice(0, start).match(/\n([ \t]*)[^\n]*$/)?.[1] ?? "      ") + "  "
    const existing = block.match(/\n[ \t]*danoPotencial:\s*'[^']*',?/)
    const updated = existing
      ? block.replace(existing[0], `\n${indent}danoPotencial: '${dano}',`)
      : `${block.slice(0, -1).replace(/,?\s*$/, ",")}\n${indent}danoPotencial: '${dano}',\n${indent.slice(2)}}`

    source = source.slice(0, start) + updated + source.slice(end + 1)
    occurrences += 1
    searchFrom = start + updated.length
  }

  return { source, occurrences }
}

function main() {
  const file = process.argv[2]
  const dryRun = process.argv.includes("--dry-run")
  if (!file) throw new Error("Indica el archivo XLSX de calibración.")

  const rows = readCalibration(file)
  const invalid = rows.filter((row) => !VALID.has(row.dano))
  if (invalid.length > 0) {
    throw new Error(`${invalid.length} fila(s) con valor inválido. Sólo se admite leve, moderado, grave o fatal. Primera: ${invalid[0]!.itemId} = ${invalid[0]!.dano}`)
  }

  // Un ítem que vive en un archivo compartido no puede recibir dos valores.
  const byTarget = new Map<string, { dano: string; codes: string[] }>()
  for (const row of rows) {
    if (isPersonEvaluationDefinition(row.code)) continue
    if (!CHECKLIST_DEFINITIONS[row.code]) throw new Error(`El checklist ${row.code} no existe en el catálogo.`)
    const key = `${resolveSectionsFile(row.code)}::${row.itemId}`
    const current = byTarget.get(key)
    if (!current) byTarget.set(key, { dano: row.dano, codes: [row.code] })
    else if (current.dano !== row.dano) {
      throw new Error(`Calibración divergente para "${row.item}" (${row.itemId}): ${current.codes.join(", ")} lo marcan ${current.dano} y ${row.code} lo marca ${row.dano}. El ítem vive en un archivo compartido y no admite dos valores.`)
    } else current.codes.push(row.code)
  }

  const perFile = new Map<string, [string, string][]>()
  for (const [key, value] of byTarget) {
    const [filePath, itemId] = key.split("::")
    const list = perFile.get(filePath!) ?? []
    list.push([itemId!, value.dano])
    perFile.set(filePath!, list)
  }

  let applied = 0
  const missing: string[] = []
  for (const [filePath, items] of perFile) {
    let source = fs.readFileSync(filePath, "utf8")
    for (const [itemId, dano] of items) {
      const result = applyToSource(source, itemId, dano)
      if (result.occurrences > 0) { source = result.source; applied += result.occurrences }
      else missing.push(`${path.basename(filePath)} · ${itemId}`)
    }
    if (!dryRun) fs.writeFileSync(filePath, source)
  }

  console.log(`${applied} ítems calibrados en ${perFile.size} archivo(s)${dryRun ? " (simulación, sin escribir)" : ""}.`)
  if (missing.length > 0) {
    console.log(`\n${missing.length} ítem(s) no encontrados en el catálogo:`)
    for (const item of missing.slice(0, 20)) console.log(`  ${item}`)
    process.exitCode = 1
  }
}

main()
