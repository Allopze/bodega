/**
 * Siembra las tres pautas de mantención preventiva de los formularios externos (encargo del
 * 2026-11-26): maquinaria por horas, camiones/tractos por km y camiones/tractos por horas.
 *
 *   npm run db:seed:pautas-preventivas -- --dry-run   # simula: escribe y revierte
 *   npm run db:seed:pautas-preventivas                # aplica
 *
 * Idempotente: una pauta que ya existe con el mismo contenido no se toca, y una que existe con
 * contenido distinto tampoco (se informa la diferencia). Requiere la migración 0404 (columna
 * `mant_schedules.cyclic`). Apunta a la base de DATABASE_URL (`.env.local`): correrlo contra
 * producción es una decisión de despliegue, no de desarrollo.
 */
import { db } from "@/db"
import { seedPreventivePautas } from "@/lib/services/mantencion/pautas-preventivas/seed"

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const report = await seedPreventivePautas(db, { dryRun })
  const verb = dryRun ? "La simulación habría escrito cambios (revertidos)." : "La carga escribió cambios."
  console.log(report.changed ? verb : "Nada que cambiar: las pautas ya estaban.")
  console.log(JSON.stringify(report, null, 2))
  if (report.pautas.some((pauta) => pauta.status === "distinta")) process.exitCode = 2
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
