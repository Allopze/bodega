import fs from "node:fs"
import path from "node:path"

// Regression tripwire, not a fine-grained budget per route: fails loudly if a
// route's first-load JS balloons well past the current worst case
// (~2.44 MB uncompressed, e.g. /combustibles/facturas) instead of silently
// growing further — see CHO-014 in AUDITORIA_INTEGRAL_CHOME.md.
const BUDGET_BYTES = 3 * 1024 * 1024

const statsPath = path.resolve(process.cwd(), ".next/diagnostics/route-bundle-stats.json")

if (!fs.existsSync(statsPath)) {
  console.error(`No se encontró ${statsPath}. Ejecuta "npm run build" antes de este chequeo.`)
  process.exit(1)
}

interface RouteStat {
  route: string
  firstLoadUncompressedJsBytes: number
}

const stats: RouteStat[] = JSON.parse(fs.readFileSync(statsPath, "utf8"))
const offenders = stats
  .filter((s) => s.firstLoadUncompressedJsBytes > BUDGET_BYTES)
  .sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)

if (offenders.length > 0) {
  console.error(`Rutas que superan el presupuesto de bundle (${(BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB first-load JS sin comprimir):`)
  for (const o of offenders) {
    console.error(`- ${o.route}: ${(o.firstLoadUncompressedJsBytes / 1024 / 1024).toFixed(2)} MB`)
  }
  process.exit(1)
}

const worst = [...stats].sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)[0]
if (worst) {
  console.log(
    `Bundle budget OK: ${stats.length} rutas analizadas, peor caso ${worst.route} = ${(worst.firstLoadUncompressedJsBytes / 1024 / 1024).toFixed(2)} MB (presupuesto ${(BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB).`,
  )
} else {
  console.log("Bundle budget OK: sin rutas en el reporte.")
}
