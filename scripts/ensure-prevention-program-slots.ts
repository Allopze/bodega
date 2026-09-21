/**
 * scripts/ensure-prevention-program-slots.ts
 *
 * Materializa las casillas del programa preventivo de cada faena activa.
 *
 * `ensurePreventionProgramSlotsForWorksiteTx` existe desde que el alta de faena
 * ocurre en tres lugares distintos, y su cabecera nombra el modo de falla:
 * «alguien agrega un cuarto punto de alta y pre-genera sólo capacitación,
 * dejando una faena sin casillas de simulacro, de CGRD ni de alcotest —
 * invisible hasta que llega una fiscalización».
 *
 * Ese cuarto punto resultó no ser un alta sino una **migración**. Las 0314 y
 * 0316 crearon `prevention_emergency_drill_slots`, `prevention_grd_meeting_slots`
 * y `prevention_alcotest_slots` vacías, y nada las llena para las faenas que ya
 * existían: el agregador sólo se invoca desde código de aplicación en el alta.
 * En dev quedaron 7 faenas activas con 168 ocurrencias de capacitación —que sí
 * se sembraron en su momento— y **cero** casillas de las otras cuatro familias.
 * Como el deploy aplica migraciones solo, producción arranca igual.
 *
 *   npm run db:ensure-program-slots
 *   PROGRAM_SLOTS_DRY_RUN=true npm run db:ensure-program-slots
 *
 * Idempotente por construcción: los identificadores son determinísticos y el
 * insert es `onConflictDoNothing`, así que reejecutar no crea filas nuevas ni
 * pisa el estado de las existentes. Por eso `db:migrate` lo corre después del
 * migrador, junto a los demás pasos de post-migración.
 *
 * No lleva `DEPLOY_MODE`: corre después del migrador, así que las tablas
 * existen, y el contenido sale de constantes congeladas, no del programa del
 * año. Una bandera que nunca se ejercita se confunde con una que sí.
 */
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { ensurePreventionProgramSlotsForWorksiteTx } from "@/lib/services/prevention-program-slots"

const DRY_RUN = process.env.PROGRAM_SLOTS_DRY_RUN === "true"

type Counts = Awaited<ReturnType<typeof ensurePreventionProgramSlotsForWorksiteTx>>

/** Señal para deshacer la transacción del ensayo conservando lo que contó. */
class DryRunRollback extends Error {
  constructor(readonly counts: Counts) {
    super("dry-run")
  }
}

/**
 * Una transacción por faena: si una falla, las anteriores quedan hechas y el
 * reintento las salta por idempotencia. Agrupar las siete en una sola haría que
 * un error en la última descartara el trabajo bueno de las seis primeras.
 */
async function ensureFor(worksiteId: string): Promise<Counts> {
  try {
    return await db.transaction(async (tx) => {
      const counts = await ensurePreventionProgramSlotsForWorksiteTx(tx, worksiteId)
      if (DRY_RUN) throw new DryRunRollback(counts)
      return counts
    })
  } catch (error) {
    if (error instanceof DryRunRollback) return error.counts
    throw error
  }
}

async function main() {
  const activas = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name))

  const totales: Counts = { training: 0, drills: 0, grdMeetings: 0, alcotest: 0, protocols: 0 }
  const porFaena: Array<{ faena: string; creadas: Counts }> = []

  for (const faena of activas) {
    const creadas = await ensureFor(faena.id)
    for (const clave of Object.keys(totales) as Array<keyof Counts>) {
      totales[clave] += creadas[clave]
    }
    const total = Object.values(creadas).reduce((suma, n) => suma + n, 0)
    if (total > 0) porFaena.push({ faena: faena.name, creadas })
  }

  console.log(JSON.stringify({
    modo: DRY_RUN ? "ensayo (sin escribir)" : "aplicado",
    faenasActivas: activas.length,
    creadas: totales,
    detalle: porFaena,
  }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
