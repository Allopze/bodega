/**
 * scripts/reconstruct-worksite-stays.ts
 *
 * Reconstruye el recorrido pasado de cada equipo por las faenas a partir de la
 * evidencia de dónde estuvo físicamente (cargas, envíos TAE, registros y OT de
 * mantención, cambios auditados de faena y, opcionalmente, planillas). Nunca
 * inventa una fecha: lo dudoso va a «Por confirmar» y no se escribe.
 *
 *   tsx --env-file=.env.local scripts/reconstruct-worksite-stays.ts --out=<informe.xlsx>                # en seco
 *   tsx --env-file=.env.local scripts/reconstruct-worksite-stays.ts --out=<informe.xlsx> --apply        # escribe
 *
 * Opciones: --max-gap-days=7 (días sin evidencia que se aceptan entre dos faenas),
 * --snapshots=<archivo.json> (planilla: [{ "date": "2026-08-21", "code": "KA-71",
 * "plate": "CBJY-18", "worksiteName": "Santa Fe" }]) y --actor-email=<correo> (quién
 * queda en la bitácora de lo escrito). Sin --apply no escribe nada. Re-ejecutable.
 * Imprime sólo conteos. La lógica está en `lib/fleet/stay-reconstruction-run.ts`.
 */
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema"
import { parseSnapshots, parseStayCliArgs } from "@/lib/fleet/stay-reconstruction-cli"
import { writeStayReport } from "@/lib/fleet/stay-reconstruction-report"
import { runStayReconstruction } from "@/lib/fleet/stay-reconstruction-run"

export async function main(argv = process.argv.slice(2)) {
  const args = parseStayCliArgs(argv)
  const snapshots = args.snapshotsFile ? parseSnapshots(await readFile(args.snapshotsFile, "utf8")) : []

  let actor: { userId: string | null; email?: string } = { userId: null, email: "script:reconstruct-worksite-stays" }
  if (args.actorEmail) {
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, args.actorEmail)).limit(1)
    if (!user) throw new Error("No existe un usuario con el correo de --actor-email.")
    actor = { userId: user.id, email: user.email }
  }

  console.log(`Reconstrucción del recorrido por faena — ${args.apply ? "escribiendo" : "en seco (no escribe)"}`)
  const result = await runStayReconstruction(db, {
    apply: args.apply, maxGapDays: args.maxGapDays, snapshots, actor,
  })
  await writeStayReport(result, args.out)

  console.log(`Equipos revisados:            ${result.vehicles}`)
  console.log(`Se aplica:                    ${result.applied.length}`)
  console.log(`Por confirmar:                ${result.toConfirm.length}`)
  console.log(`Sin evidencia:                ${result.noEvidence.length}`)
  console.log(`Saltados (con traslado):      ${result.skippedTransfers.length}`)
  console.log(`Planilla sin calce:           ${result.unmatched.length}`)
  console.log(`Sin cambios (ya coincide):    ${result.unchanged}`)
  console.log(`Escritos:                     ${result.written}`)
  if (result.failed.length > 0) console.log(`Con error (ver hoja «Con error»): ${result.failed.length}`)
  console.log("Informe escrito.")
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
