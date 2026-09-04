/**
 * scripts/extract-re08-master-list.ts
 *
 * Extrae el RE-08 (Listado Maestro de Información Documentada) del XLSX y
 * emite la constante que `lib/services/prevention-documents/master-list-2026.ts`
 * embebe.
 *
 *   npx tsx scripts/extract-re08-master-list.ts > /tmp/re08.ts
 *
 * **Sólo para desarrollo.** `docs/` no se copia al contenedor, así que un
 * sembrador que leyera el XLSX en tiempo de despliegue fallaría. Se corre a mano
 * cuando el RE-08 cambia de versión; el `sha256` que imprime va a `RE08_SOURCE`
 * y un test lo verifica contra el archivo real.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"

const SOURCE = "docs/prevención/SGI Chome_2026/7 Apoyo/DO-11 Información Documentada/RE-08 LISTADO MAESTRO DE INFORMACIÓN DOCUMENTADA.xlsx"

/** El serial de Excel a `YYYY-MM-DD`. Epoch 1899-12-30, como todo el resto del repo. */
function excelSerialToIso(value: unknown): string | null {
  // ExcelJS ya devuelve `Date` para las celdas con formato de fecha; el serial
  // crudo aparece sólo donde la celda quedó como número.
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const serial = Number(value)
  if (!Number.isFinite(serial) || serial <= 0) return null
  const ms = Math.round((serial - 25_569) * 86_400_000)
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/**
 * El valor de una celda como texto. La columna Nº está auto-numerada con
 * fórmulas, así que hay que leer su `result`; sin eso `String(value)` da
 * "[object Object]" y la fila se descarta en silencio.
 */
function cell(row: ExcelJS.Row, index: number): string {
  const value = row.getCell(index).value
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    if ("richText" in value) return (value.richText as { text: string }[]).map((part) => part.text).join("").trim()
    if ("result" in value) return String((value as { result: unknown }).result ?? "").trim()
    if ("text" in value) return String((value as { text: unknown }).text ?? "").trim()
    if (value instanceof Date) return value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

async function main() {
  const buffer = readFileSync(SOURCE)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as never)
  const sheet = workbook.worksheets[0]!

  const entries: string[] = []
  let vacantes = 0
  sheet.eachRow((row) => {
    const n = Number(cell(row, 1))
    if (!Number.isInteger(n) || n <= 0) return
    const code = cell(row, 2)
    const name = cell(row, 3)
    if (!name || /^vacante$/i.test(name)) { vacantes++; return }
    const fields = {
      n,
      code: code && code.toLowerCase() !== "sin código" ? code : null,
      name,
      version: Number(cell(row, 4)) || null,
      effectiveFrom: excelSerialToIso(row.getCell(5).value),
      process: cell(row, 7) || null,
      retention: cell(row, 8) || null,
      owner: cell(row, 9) || null,
      folder: cell(row, 10) || null,
      subfolder: cell(row, 11) && cell(row, 11) !== "N/A" ? cell(row, 11) : null,
    }
    entries.push(`  ${JSON.stringify(fields)},`)
  })

  console.log(`// ${entries.length} documentos · ${vacantes} código(s) vacante(s) sin documento`)
  console.log(`// sha256 del archivo: ${createHash("sha256").update(buffer).digest("hex")}`)
  console.log("export const RE08_DOCUMENTS: readonly Re08Document[] = [")
  for (const entry of entries) console.log(entry)
  console.log("] as const")
}

main().catch((error) => { console.error(error); process.exit(1) })
