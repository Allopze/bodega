import ExcelJS from "exceljs"
import path from "node:path"
const FILE = process.argv[2]
const main = async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.resolve(FILE))
  for (const ws of wb.worksheets) {
    // Print the merged cells in rows 9-13 (header area)
    console.log(`\n## HOJA: ${ws.name}`)
    console.log(`Columnas totales: ${ws.columnCount}`)
    // header month-row (row 10 typically) and week-row (row 11)
    for (const r of [9, 10, 11, 12]) {
      const cells = []
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = ws.getRow(r).getCell(c).value
        if (v === null || v === undefined || v === "") continue
        let s = typeof v === "object" ? (v.text ?? v.richText?.map((x) => x.text).join("") ?? JSON.stringify(v).slice(0, 50)) : String(v)
        cells.push(`${c}:${String(s).slice(0, 24)}`)
      }
      console.log(`  R${r}: ${cells.join(" | ")}`)
    }
    // Print merged ranges count
    console.log(`  Merged ranges: ${(ws.model?.merges || []).length}`)
    // Print sample of last 50 rows of header structure (rows 100-110)
    const headerContinu = []
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
      const v = ws.getRow(110).getCell(c).value
      if (v === null || v === undefined || v === "") continue
      let s = typeof v === "object" ? (v.text ?? JSON.stringify(v).slice(0, 30)) : String(v)
      headerContinu.push(`${c}:${String(s).slice(0, 20)}`)
    }
    console.log(`  R110 muestra: ${headerContinu.join(" | ")}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
