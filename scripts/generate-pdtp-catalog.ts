import fs from "node:fs/promises"
import path from "node:path"
import {
  extractPdtpCatalogFromWorkbook,
  readPdtpWorkbook,
} from "../lib/services/prevention-pdtp-catalog"
import { PDTP_2026_PROGRAM_SOURCE, PDTP_2026_REMOVED_ACTIVITIES } from "../lib/services/pdtp-adapters/contract-2026"

// Fuente congelada del programa vigente (87 actividades, con columna OBJETIVO).
// La quita de 4 y 8 ya viene aplicada en ese archivo, así que `applyRemovals`
// queda como no-op idempotente; sigue ahí para que apuntar este script al
// documento histórico (89) también produzca el programa vigente.
// Uso: `tsx scripts/generate-pdtp-catalog.ts [rutaSalida]`.
const workbookPath = path.resolve(process.cwd(), PDTP_2026_PROGRAM_SOURCE.filename)
const outputPath = path.resolve(process.cwd(), process.argv[2] ?? "db/seed/pdtp-catalog-2026.json")

function applyRemovals(catalog: ReturnType<typeof extractPdtpCatalogFromWorkbook>) {
  const removed = new Set<number>(PDTP_2026_REMOVED_ACTIVITIES)
  return {
    ...catalog,
    activities: catalog.activities.filter((a) => !removed.has(a.n)),
    objectives: catalog.objectives.map((o) => ({
      ...o,
      activityNumbers: o.activityNumbers.filter((n) => !removed.has(n)),
    })),
    sheetActivities: Object.fromEntries(
      Object.entries(catalog.sheetActivities).map(([key, numbers]) => [
        key,
        numbers.filter((n) => !removed.has(n)),
      ]),
    ),
  }
}

async function main() {
  const workbook = await readPdtpWorkbook(workbookPath)
  // El seed guarda solo la definicion del programa; ejecuciones historicas,
  // metadatos y warnings se consumen en la importacion, no en la semilla.
  const { objectives, activities, sheetActivities } = applyRemovals(extractPdtpCatalogFromWorkbook(workbook))
  const catalog = { objectives, activities, sheetActivities }

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
