/**
 * scripts/import-consolidado-mantencion.ts
 *
 * Carga el consolidado de Chome (combustible, mantención e inspección) al historial de
 * Mantención: MANTENCIONES, INSPECCIONES, HALLAZGOS_INSPECCION y PAUTAS_PREVENTIVAS.
 * Contrato y reglas: `docs/mantencion/trinorma/CONTRATOS.md` (WP2) y
 * `lib/services/mantencion/consolidated-import.ts`.
 *
 *   npx tsx scripts/import-consolidado-mantencion.ts --file <ruta.xlsx> --actor-email <correo>                       # simulación
 *   npx tsx scripts/import-consolidado-mantencion.ts --file <ruta.xlsx> --actor-email <correo> --report <ruta.md>    # simulación + informe
 *   npx tsx scripts/import-consolidado-mantencion.ts --file <ruta.xlsx> --actor-email <correo> --apply --report <ruta.md>
 *
 * - Sin `--apply` corre el mismo código en una transacción y la deshace: lo que informa es lo que
 *   `--apply` haría. Nada queda escrito.
 * - Una sola transacción con `pg_advisory_xact_lock(hashtext('mant-historical-import'))` y auditoría
 *   `mant_historical_import` a nombre de `--actor-email`.
 * - Idempotente: volver a correrlo no duplica ni cambia nada. Una fila que ya existe sólo se completa
 *   (columnas nuevas y vínculos vacíos); nunca se pisan `fields`, el origen ni un vínculo manual.
 * - El informe en Markdown no lleva correos ni nombres de personas.
 *
 * Antes de aplicar en producción conviene haber corrido `apply-trinorma-maestros` (alias de faenas,
 * como «Cholguan»): las filas cuya faena no se resuelve quedan sin faena, y una segunda corrida las completa.
 * El archivo NO se copia al repositorio: se pasa por `--file`.
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema"
import { formatConsolidatedReport, importConsolidated } from "@/lib/services/mantencion/consolidated-import"

interface Args { file: string; actorEmail: string; apply: boolean; report: string | null }

function option(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${name}.`)
  return value
}

export function parseArgs(argv: string[]): Args {
  const known = new Set(["--file", "--actor-email", "--report", "--apply"])
  const unknown = argv.slice(2).filter((arg) => arg.startsWith("--") && !known.has(arg))
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(", ")}.`)
  const file = option(argv, "--file")
  if (!file) throw new Error("Falta --file <ruta del consolidado .xlsx>.")
  const actorEmail = option(argv, "--actor-email")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora y la importación necesitan un responsable.")
  return { file, actorEmail, apply: argv.includes("--apply"), report: option(argv, "--report") }
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv)
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, args.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${args.actorEmail}: la importación necesita un responsable.`)
  const bytes = await readFile(args.file)
  console.log(`Importación del consolidado — ${args.apply ? "ESCRIBIENDO" : "simulación (no se guarda nada)"}`)
  const result = await importConsolidated({ userId: actorRow.id, email: actorRow.email }, new Uint8Array(bytes), path.basename(args.file), { apply: args.apply })
  if (!result.ok) throw new Error(result.message)
  const report = result.data
  for (const [sheet, c] of Object.entries(report.sheets)) {
    console.log(`${sheet.padEnd(15)} filas ${c.total} · nuevas ${c.created} · completadas ${c.completed} · sin cambios ${c.unchanged} · con diferencia ${c.withDifference} · rechazadas ${c.rejected} · prueba ${c.test} (excluidas ${c.testExcluded})`)
  }
  if (args.report) {
    await writeFile(args.report, `${formatConsolidatedReport(report)}\n`, "utf8")
    console.log(`\nInforme escrito en ${args.report}`)
  }
  console.log(args.apply ? "\nAplicado." : "\nSimulación terminada: la transacción se deshizo. Vuelve a correr con --apply para guardar.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
