/**
 * Diagnóstico de archivos XLSX para importación.
 *
 * Uso:
 *   npx tsx scripts/diagnose-xlsx.ts <ruta-al-archivo.xlsx>
 *
 * Verifica que sea un ZIP válido, lo abre con ExcelJS y muestra
 * cabeceras + primeras filas para depurar errores de importación.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import ExcelJS from "exceljs"
import { HEADER_ALIASES } from "../lib/services/epp-import.types"

function main() {
  const filePath = resolve(process.argv[2] ?? "")
  if (!filePath || !existsSync(filePath)) {
    console.error("❌ Uso: npx tsx scripts/diagnose-xlsx.ts <ruta-al-archivo.xlsx>")
    process.exit(1)
  }

  const raw = readFileSync(filePath)
  const stats = { size: raw.length, sha256: createHash("sha256").update(raw).digest("hex") }
  console.log(`📄 Archivo: ${filePath}`)
  console.log(`   Tamaño: ${(stats.size / 1024).toFixed(1)} KB`)
  console.log(`   SHA256: ${stats.sha256}`)

  // ── 1. Verificar que sea un ZIP válido ────────────────────────────
  const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  if (raw.slice(0, 4).equals(MAGIC_ZIP)) {
    console.log("✅ Es un ZIP válido (XLSX = ZIP)")
  } else {
    console.log(`❌ NO ES UN ZIP. Magic bytes: ${raw.slice(0, 4).toString("hex")}`)
    console.log("   Posibles causas: archivo truncado, formato .xls antiguo, o no es un Excel.")
    process.exit(1)
  }

  // ── 2. Listar contenido interno del ZIP ───────────────────────────
  try {
    const unzipOut = execSync(`unzip -l "${filePath}"`, { encoding: "utf-8", timeout: 5000 })
    console.log("\n📦 Contenido del ZIP:")
    console.log(unzipOut.slice(0, 1200))
  } catch {
    console.log("\n⚠️  No se pudo listar con unzip, continuando con ExcelJS...")
  }

  // ── 2b. Dump workbook.xml para ver referencias a hojas ────────────
  try {
    const wbXml = execSync(
      `unzip -p "${filePath}" xl/workbook.xml 2>/dev/null | head -100`,
      { encoding: "utf-8", timeout: 5000 }
    )
    console.log("\n📄 xl/workbook.xml (referencias a sheets):")
    console.log(wbXml.slice(0, 2000))
  } catch {
    console.log("\n⚠️  No se pudo leer xl/workbook.xml")
  }

  // ── 2c. Dump sheet1.xml primeros caracteres ───────────────────────
  try {
    const sheetXml = execSync(
      `unzip -p "${filePath}" xl/worksheets/sheet1.xml 2>/dev/null | head -50`,
      { encoding: "utf-8", timeout: 5000 }
    )
    console.log("\n📄 xl/worksheets/sheet1.xml (primeros ~4000 chars):")
    console.log(sheetXml.slice(0, 4000))
  } catch {
    console.log("\n⚠️  No se pudo leer xl/worksheets/sheet1.xml")
  }

  // ── 3. Abrir con ExcelJS (igual que en parseEppWorkbook) ──────────
  const workbook = new ExcelJS.Workbook()
  try {
    workbook.xlsx.load(raw as never, {
      ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"],
    })
    console.log("✅ ExcelJS cargó el workbook correctamente")
  } catch (err) {
    console.error("\n❌ ExcelJS falló al cargar el XLSX:")
    console.error(`   ${err instanceof Error ? err.message : err}`)
    if (err instanceof Error && err.stack) {
      console.error("\n   Stack (primeras líneas):")
      console.error(err.stack.split("\n").slice(0, 4).join("\n"))
    }
    process.exit(1)
  }

  // ── 4. Mostrar hojas ─────────────────────────────────────────────
  console.log(`\n📋 Hojas encontradas por ExcelJS: ${workbook.worksheets.length}`)
  for (const ws of workbook.worksheets) {
    console.log(`   - "${ws.name}" (${ws.rowCount} filas × ${ws.columnCount} columnas)`)
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    console.log("\n⚠️  ExcelJS no encontró hojas a pesar de que sheet1.xml existe en el ZIP.")
    console.log("   Causa probable: el workbook.xml no referencia la hoja o usa un namespace incompatible.")
    process.exit(0)
  }

  console.log(`\n🔍 Primera hoja: "${sheet.name}"`)

  const row1 = sheet.getRow(1)
  const headers: string[] = []
  let maxCol = 0
  row1.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim()
    if (colNumber > maxCol) maxCol = colNumber
  })
  console.log("\n📌 Cabeceras (fila 1):")
  headers.forEach((h, i) => {
    if (h) console.log(`   Columna ${i}: "${h}"`)
  })

  console.log("\n📌 Headers reconocidos por HEADER_ALIASES:")
  for (let col = 1; col <= maxCol; col++) {
    const header = headers[col]
    if (!header) continue
    const normalized = header
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase()
    const mapped = HEADER_ALIASES[normalized]
    if (mapped) {
      console.log(`   ✅ "${header}" → campo interno: "${mapped}"`)
    } else {
      console.log(`   ❌ "${header}" → NO RECONOCIDO`)
    }
  }

  // ── 6. Filas 2 a 5 ──────────────────────────────────────────────
  console.log("\n📊 Primeras filas de datos:")
  let rowCount = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (rowCount >= 5) return
    rowCount++
    const cells: string[] = []
    row.eachCell((cell, colNumber) => {
      const text = String(cell.value ?? "").trim()
      if (text) cells.push(`[${colNumber}] ${text}`)
    })
    console.log(`   Fila ${rowNumber}: ${cells.join(", ") || "(vacía)"}`)
  })

  const totalDataRows = sheet.rowCount - 1
  console.log(`\n📊 Total filas de datos (sin header): ${totalDataRows}`)
  console.log("\n✅ Diagnóstico completo.")
}

main()
