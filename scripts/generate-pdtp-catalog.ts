import fs from "node:fs/promises"
import path from "node:path"
import {
  extractPdtpCatalogFromWorkbook,
  readPdtpWorkbook,
} from "../lib/services/prevention-pdtp-catalog"

const workbookPath = path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx")
const outputPath = path.resolve(process.cwd(), "db/seed/pdtp-catalog-2026.json")

async function main() {
  const workbook = readPdtpWorkbook(workbookPath)
  const catalog = extractPdtpCatalogFromWorkbook(workbook)

  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")

  console.log(`PDTP catalog written to ${path.relative(process.cwd(), outputPath)}`)
  console.log(`Activities: ${catalog.activities.length}`)
  console.log(`Objectives: ${catalog.objectives.length}`)
  console.log(`Sheets: ${Object.keys(catalog.sheetActivities).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
