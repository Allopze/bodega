/**
 * scripts/report-pdtp-closure-drift.ts
 *
 * D6 del plan de pendientes de Prevención: antes de desplegar un cambio en la
 * fórmula del cumplimiento PDTP, cuenta qué cierres mensuales vigentes se
 * verán "desviados" (su foto congelada ya no coincide con el cálculo en vivo).
 * La foto no cambia; lo que cambia es el aviso que ve quien la consulta.
 *
 * Solo lee. Correrlo con un usuario de base de datos de solo lectura:
 *
 *   DATABASE_URL=<solo lectura> npm run pdtp:report-closure-drift
 *
 * Importante: mide el código con el que se corre. Para anticipar el efecto de
 * un despliegue, correrlo desde el checkout de la versión NUEVA contra la base
 * actual.
 */
import { reportPdtpPeriodClosureDrift } from "@/lib/services/pdtp/period-closures"

async function main() {
  const report = await reportPdtpPeriodClosureDrift()
  console.log(`Cierres vigentes revisados: ${report.checked}`)
  console.log(`Cierres que quedarían desviados: ${report.drifted.length}`)
  for (const row of report.drifted) {
    console.log(`  ${row.year}-${String(row.month).padStart(2, "0")}  programa ${row.programId}  faena ${row.worksiteId}  (cierre ${row.closureId})`)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
