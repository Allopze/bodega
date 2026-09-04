import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"
import { db } from "@/db"
import { preventionInspectionImportBatches, preventionInspectionImportRows } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"

const ROOT = path.resolve("docs/prevención/SGI Chome_2026/8 Operación/3_Faenas/Faena Biodiversa/3_Documentos SST/8.Inpecciones y Observaciones/Inspecciones a Plantas de Essbio/Biodiversa")
const ANNEX_15 = path.join(ROOT, "Anexo 15 Seguimiento y Control de Observaciones e Inspecciones 2026.xlsx")
const ANNEX_15_COPY = path.join(ROOT, "ENERO 2026/Anexo 15 Seguimiento y Control de Observaciones e Inspecciones 2026.xlsx")
const OUTPUT = path.resolve("qa/reports/inspection-history-reconciliation.xlsx")
const APPLY = process.argv.includes("--apply")

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex") }
function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    const rich = (value as { richText?: { text: string }[] }).richText
    if (rich) return rich.map((part) => part.text).join("")
    return String((value as { text?: unknown; result?: unknown }).text ?? (value as { result?: unknown }).result ?? "")
  }
  return String(value).trim()
}
function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase() }
function xmlText(file: string) {
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { maxBuffer: 30 * 1024 * 1024 }).toString("utf8")
  return xml.replace(/<w:tab\/?\s*>/g, "\t").replace(/<w:br\/?\s*>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n").trim()
}
function mediaEntries(file: string) {
  return execFileSync("unzip", ["-Z1", file], { maxBuffer: 10 * 1024 * 1024 }).toString("utf8").split("\n").filter((entry) => entry.startsWith("word/media/"))
}

type ReconciliationRow = { sourceType: string; sourceFile: string; sourceKey: string; checksum: string; status: string; reason: string; snapshot: Record<string, unknown> }

async function annex15Rows(file: string): Promise<ReconciliationRow[]> {
  const bytes = await fs.readFile(file)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  const rows: ReconciliationRow[] = []
  for (const sheet of workbook.worksheets) {
    const year = /2025/.test(sheet.name) ? 2025 : 2026
    for (let rowNumber = 4; rowNumber <= 11; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      const number = text(row.getCell(1).value)
      if (!number) continue
      const snapshot = {
        year,
        number,
        date: text(row.getCell(2).value),
        area: text(row.getCell(3).value),
        deviation: text(row.getCell(4).value),
        correctiveMeasure: text(row.getCell(5).value),
        responsible: text(row.getCell(6).value),
        targetDate: text(row.getCell(7).value),
        status: text(row.getCell(8).value),
        progress: text(row.getCell(9).value),
        comments: text(row.getCell(10).value),
      }
      const completeEnough = Boolean(snapshot.date && snapshot.area && snapshot.deviation)
      rows.push({
        sourceType: "annex_15_xlsx", sourceFile: path.relative(process.cwd(), file),
        sourceKey: `${year}:${number}`, checksum: sha256(bytes), status: "pending_review",
        reason: completeEnough ? "Requiere conciliación humana con documento, hallazgo y CAPA." : "Fila incompleta; no se infieren datos ausentes.",
        snapshot,
      })
    }
  }
  return rows
}

async function docxRows(): Promise<ReconciliationRow[]> {
  const files: string[] = []
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (/\.docx$/i.test(entry.name)) files.push(target)
    }
  }
  await walk(ROOT)
  return Promise.all(files.sort().map(async (file) => {
    const bytes = await fs.readFile(file)
    return {
      sourceType: "annex_08_docx",
      sourceFile: path.relative(process.cwd(), file),
      sourceKey: path.relative(ROOT, file),
      checksum: sha256(bytes),
      status: "pending_review",
      reason: "Documento íntegro conservado; campos y fotografías requieren validación humana antes de crear CAPA.",
      snapshot: { extractedText: xmlText(file), embeddedMedia: mediaEntries(file), originalPath: path.relative(process.cwd(), file) },
    }
  }))
}

async function stage(rows: ReconciliationRow[]) {
  const groups = new Map<string, ReconciliationRow[]>()
  for (const row of rows) {
    const key = `${row.sourceType}:${row.checksum}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  for (const items of groups.values()) {
    const first = items[0]!
    const batchId = `insimp-${nanoid()}`
    const [created] = await db.insert(preventionInspectionImportBatches).values({
      id: batchId, sourceKind: first.sourceType, sourceFileName: first.sourceFile,
      sourceChecksumSha256: first.checksum, status: "staged", summary: { rows: items.length },
    }).onConflictDoNothing().returning({ id: preventionInspectionImportBatches.id })
    const resolvedBatchId = created?.id ?? (await db.query.preventionInspectionImportBatches.findFirst({
      where: (table, { and, eq }) => and(eq(table.sourceKind, first.sourceType), eq(table.sourceChecksumSha256, first.checksum)),
      columns: { id: true },
    }))?.id
    if (!resolvedBatchId) throw new Error("No se pudo resolver el lote idempotente.")
    await db.insert(preventionInspectionImportRows).values(items.map((item) => ({
      id: `insimpr-${nanoid()}`, batchId: resolvedBatchId, sourceKey: item.sourceKey,
      rawSnapshot: item.snapshot, status: item.status, reviewNote: item.reason,
    }))).onConflictDoNothing()
  }
}

async function writeReport(rows: ReconciliationRow[], duplicates: ReconciliationRow[]) {
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true })
  const workbook = new ExcelJS.Workbook()
  const specs = [
    ["Importados", rows.filter((row) => row.status === "imported")],
    ["Duplicados", duplicates],
    ["Pendientes", rows.filter((row) => row.status === "pending_review")],
    ["Descartados", rows.filter((row) => row.status === "rejected")],
  ] as const
  for (const [name, selected] of specs) {
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(["Tipo", "Archivo", "Clave", "Checksum", "Estado", "Motivo"])
    for (const row of selected) sheet.addRow([row.sourceType, sanitizeCell(row.sourceFile), sanitizeCell(row.sourceKey), row.checksum, row.status, sanitizeCell(row.reason)])
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.columns.forEach((column) => { column.width = 28 })
  }
  await workbook.xlsx.writeFile(OUTPUT)
}

async function main() {
  const [primaryRows, copyRows, docs] = await Promise.all([annex15Rows(ANNEX_15), annex15Rows(ANNEX_15_COPY), docxRows()])
  const canonicalFingerprints = new Set(primaryRows.map((row) => normalize(JSON.stringify(row.snapshot))))
  const duplicates = copyRows.filter((row) => canonicalFingerprints.has(normalize(JSON.stringify(row.snapshot)))).map((row) => ({ ...row, status: "duplicate", reason: "Copia semántica de la fila canónica del Anexo 15." }))
  const rows = [...primaryRows, ...docs]
  if (APPLY) await stage(rows)
  await writeReport(rows, duplicates)
  const summary = { mode: APPLY ? "staged" : "dry-run", annex15Unique: primaryRows.length, annex15Duplicates: duplicates.length, annex08Documents: docs.length, pendingReview: rows.length, report: path.relative(process.cwd(), OUTPUT) }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
