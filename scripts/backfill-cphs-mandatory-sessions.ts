/**
 * scripts/backfill-cphs-mandatory-sessions.ts
 *
 * Materializa las 12 sesiones ordinarias mensuales (Task 10, DS 54) en los
 * programas de trabajo del comité paritario que ya estaban `active` **antes**
 * de la migración 0322 (columna `is_mandatory_session` + su índice único
 * parcial en `prevention_committee_program_activities`).
 *
 * Mismo incidente que motivó `scripts/ensure-prevention-program-slots.ts`,
 * con otra tabla: `ensureMonthlySessionActivities` sólo se invoca desde
 * `activateProgram` (`lib/services/prevention-cphs-program.ts`), y un
 * programa no puede volver a pasar por `activateProgram` una vez que salió de
 * `draft` — la transición es de un solo sentido. Un comité cuyo programa 2026
 * ya estaba aprobado antes de desplegar esta migración se queda sin sus 12
 * filas de sesión para siempre, salvo que algo más las genere: el deploy sólo
 * aplica la migración de schema, no vuelve a ejecutar código de aplicación
 * contra las filas existentes.
 *
 *   npm run db:backfill-cphs-sessions
 *   CPHS_SESSIONS_DRY_RUN=true npm run db:backfill-cphs-sessions
 *
 * Idempotente por construcción: `ensureMonthlySessionActivities` usa
 * identificadores determinísticos (`programId` + mes) y un
 * `onConflictDoNothing` sobre el índice único parcial, así que reejecutar el
 * script no crea filas nuevas ni pisa las existentes.
 *
 * No lleva `DEPLOY_MODE`: corre después del migrador, así que la columna y el
 * índice ya existen, y el contenido sale de una constante (`monthLabel`), no
 * del año calendario. Una bandera que nunca se ejercita se confunde con una
 * que sí.
 */
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionCommitteePrograms } from "@/db/schema"
import { ensureMonthlySessionActivities } from "@/lib/services/prevention-cphs-program"

const DRY_RUN = process.env.CPHS_SESSIONS_DRY_RUN === "true"

/** Señal para deshacer la transacción del ensayo conservando lo que contó. */
class DryRunRollback extends Error {
  constructor(readonly created: number) {
    super("dry-run")
  }
}

/**
 * Una transacción por programa: si uno falla, los anteriores quedan hechos y
 * el reintento los salta por idempotencia. Agruparlos en una sola transacción
 * haría que un error en el último programa descartara el trabajo bueno de
 * los anteriores.
 */
async function ensureFor(programId: string, approvedByUserId: string): Promise<number> {
  try {
    return await db.transaction(async (tx) => {
      const created = await ensureMonthlySessionActivities(tx, programId, approvedByUserId)
      if (DRY_RUN) throw new DryRunRollback(created)
      return created
    })
  } catch (error) {
    if (error instanceof DryRunRollback) return error.created
    throw error
  }
}

export interface CphsSessionsBackfillReport {
  modo: "ensayo (sin escribir)" | "aplicado"
  programasActivos: number
  creadas: number
  detalle: Array<{ programId: string; year: number; creadas: number }>
}

export async function backfillCphsMandatorySessions(): Promise<CphsSessionsBackfillReport> {
  const activos = await db.select({
    id: preventionCommitteePrograms.id,
    year: preventionCommitteePrograms.year,
    // El CHECK `prevention_committee_program_approval_consistent` exige
    // `approvedByUserId` no nulo para todo estado que no sea `draft`, así que
    // esta faena de programas `active` siempre lo trae — se atribuye la
    // pre-generación a quien aprobó el programa, no a un usuario "sistema"
    // inventado que tendría que existir en `users` para satisfacer la FK.
    approvedByUserId: preventionCommitteePrograms.approvedByUserId,
  })
    .from(preventionCommitteePrograms)
    .where(eq(preventionCommitteePrograms.status, "active"))

  let creadas = 0
  const detalle: CphsSessionsBackfillReport["detalle"] = []
  for (const programa of activos) {
    if (!programa.approvedByUserId) {
      throw new Error(`El programa ${programa.id} está 'active' sin approvedByUserId: el CHECK de base lo impide, revisa integridad de datos.`)
    }
    const creadasPrograma = await ensureFor(programa.id, programa.approvedByUserId)
    creadas += creadasPrograma
    if (creadasPrograma > 0) detalle.push({ programId: programa.id, year: programa.year, creadas: creadasPrograma })
  }

  return {
    modo: DRY_RUN ? "ensayo (sin escribir)" : "aplicado",
    programasActivos: activos.length,
    creadas,
    detalle,
  }
}

async function main() {
  const report = await backfillCphsMandatorySessions()
  console.log(JSON.stringify(report, null, 2))
}

const invokedPath = process.argv[1]
const isDirectInvocation = invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
