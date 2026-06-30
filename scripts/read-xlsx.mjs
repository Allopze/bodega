import ExcelJS from "exceljs"
import path from "node:path"

const FILE = process.argv[2]
const SHEET = process.argv[3] || null
const main = async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.resolve(FILE))
  const sheets = SHEET ? wb.worksheets.filter((ws) => ws.name.includes(SHEET)) : wb.worksheets
  for (const ws of sheets) {
    console.log("\n" + "=".repeat(90))
    console.log(`# HOJA: ${ws.name}  (${ws.rowCount} filas × ${ws.columnCount} cols)`)
    console.log("=".repeat(90))
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const cells = []
      let nonEmpty = 0
      for (let c = 1; c <= Math.min(ws.columnCount, 12); c++) {
        const v = row.getCell(c).value
        if (v === null || v === undefined || v === "") continue
        nonEmpty++
        let s
        if (typeof v === "object") {
          if ("text" in v) s = v.text
          else if ("result" in v) s = String(v.result)
          else if ("richText" in v) s = v.richText.map((x) => x.text).join("")
          else if ("formula" in v) s = `=${v.formula}`
          else s = JSON.stringify(v).slice(0, 80)
        } else s = String(v)
        s = String(s).replace(/\s+/g, " ").slice(0, 110)
        cells.push(`${c}:${s}`)
      }
      if (nonEmpty === 0) continue
      console.log(`R${String(r).padStart(4, "0")} | ${cells.join(" | ")}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
