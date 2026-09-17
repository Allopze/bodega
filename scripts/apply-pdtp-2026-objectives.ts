/**
 * scripts/apply-pdtp-2026-objectives.ts
 *
 * Backfill de los 8 objetivos del programa preventivo 2026 (RE-36) y su
 * asignación a las actividades existentes por número de catálogo legado
 * (`pdtpObjectiveForLegacyNumber`, `lib/services/pdtp/objectives.ts`).
 *
 * Escribe directo con Drizzle, sin pasar por `upsertPdtpObjective` /
 * `setPdtpActivityObjective`: esos dos exigen `assertPdtpProgramEditableState`
 * (programa en borrador, sin firmar), y este backfill corre justo sobre el
 * programa **activo** del año — igual que `apply-pdtp-2026-mechanisms.ts`, que
 * por la misma razón tampoco pasa por el servicio. La contrapartida es que no
 * deja entrada en el changelog del programa; para un backfill de catálogo,
 * ejecutado una vez por año y antes de firmar, no hace falta.
 *
 *   npm run pdtp:apply-objectives
 *   PDTP_OBJECTIVES_DRY_RUN=true npm run pdtp:apply-objectives
 *   PDTP_OBJECTIVES_DEPLOY_MODE=true node scripts/apply-pdtp-objectives.mjs
 *
 * Idempotente: una segunda corrida no crea objetivos duplicados (se detectan
 * por `code`, único por programa) ni reasigna actividades que ya tienen
 * objetivo — incluida una reasignación manual hecha desde el editor, que este
 * script nunca pisa.
 *
 * Nota (2026-09-17): al correr en el programa activo local, `objectives`
 * entra en la huella firmada del contenido (`content-digest.ts`) y el
 * programa queda con `digestDrift=true`. Es esperado: el botón "Crear nueva
 * versión" del editor lo resuelve. En producción este script corre **antes**
 * de firmar, así que el drift no llega a ocurrir ahí.
 */

import { pathToFileURL } from "node:url"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpObjectives, pdtpPrograms } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { PDTP_2026_OBJECTIVES, pdtpObjectiveForLegacyNumber } from "@/lib/services/pdtp/objectives"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_OBJECTIVES_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_OBJECTIVES_DEPLOY_MODE === "true"

/**
 * Corta la ejecución por una condición que en el deploy no es un error.
 *
 * Invocado a mano el script tiene que fallar fuerte. Dentro del deploy
 * abortar dejaría la app anterior en pie por un dato que no bloquea el
 * arranque.
 */
function bail(reason: string): never {
  if (DEPLOY_MODE) {
    console.warn(`  ⚠ ${reason}`)
    console.warn("    Modo deploy: se omite el paso sin abortar el despliegue.")
    process.exit(0)
  }
  throw new Error(reason)
}

export type ObjectiveCatalogPlanRow = { code: string; name: string; displayOrder: number }
export type ActivityObjectivePlanRow = { activityId: string; objectiveCode: string }

/**
 * Objetivos del catálogo 2026 que faltan por crear en el programa. No toca
 * los que ya existen (mismo `code`): un objetivo editado a mano en el editor
 * —nombre u orden distintos del catálogo de referencia— no se revierte.
 */
export function planObjectiveCatalog(existingObjectives: Array<{ code: string }>): ObjectiveCatalogPlanRow[] {
  const existingCodes = new Set(existingObjectives.map((objective) => objective.code))
  return PDTP_2026_OBJECTIVES
    .map((objective, index) => ({ code: objective.code, name: objective.name, displayOrder: index }))
    .filter((objective) => !existingCodes.has(objective.code))
}

/**
 * Actividades (activas o retiradas) que todavía no tienen objetivo y cuyo
 * número de catálogo legado cae dentro de un rango del mapa 2026. Ignora las
 * ya asignadas a propósito: es lo que hace idempotente una segunda corrida y
 * lo que respeta una reasignación manual hecha desde el editor.
 */
export function planObjectiveAssignments(
  activities: Array<{ id: string; n: number; objectiveId: string | null }>,
): ActivityObjectivePlanRow[] {
  const plan: ActivityObjectivePlanRow[] = []
  for (const activity of activities) {
    if (activity.objectiveId) continue
    const objectiveCode = pdtpObjectiveForLegacyNumber(activity.n)
    if (objectiveCode) plan.push({ activityId: activity.id, objectiveCode })
  }
  return plan
}

export type Pdtp2026ObjectivesBackfillPlan = {
  objectivesToCreate: ObjectiveCatalogPlanRow[]
  activityAssignments: ActivityObjectivePlanRow[]
}

/** Lee el estado actual del programa y arma el plan de backfill sin escribir nada. */
export async function planPdtp2026ObjectivesBackfill(programId: string): Promise<Pdtp2026ObjectivesBackfillPlan> {
  const existingObjectives = await db.select({ code: pdtpObjectives.code })
    .from(pdtpObjectives)
    .where(eq(pdtpObjectives.programId, programId))
  const activities = await db.select({ id: pdtpActivities.id, n: pdtpActivities.n, objectiveId: pdtpActivities.objectiveId })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, programId))

  return {
    objectivesToCreate: planObjectiveCatalog(existingObjectives),
    activityAssignments: planObjectiveAssignments(activities),
  }
}

export type Pdtp2026ObjectivesBackfillResult = { objectivesCreated: number; activitiesAssigned: number }

/** Aplica el plan: crea los objetivos que faltan y asigna las actividades pendientes. */
export async function applyPdtp2026ObjectivesPlan(
  programId: string,
  plan: Pdtp2026ObjectivesBackfillPlan,
): Promise<Pdtp2026ObjectivesBackfillResult> {
  const now = new Date().toISOString()

  if (plan.objectivesToCreate.length > 0) {
    await db.insert(pdtpObjectives).values(plan.objectivesToCreate.map((objective) => ({
      id: `pdtp-objective-${nanoid()}`,
      programId,
      code: objective.code,
      name: objective.name,
      displayOrder: objective.displayOrder,
      createdAt: now,
      updatedAt: now,
    })))
  }

  if (plan.activityAssignments.length > 0) {
    const objectiveRows = await db.select({ id: pdtpObjectives.id, code: pdtpObjectives.code })
      .from(pdtpObjectives)
      .where(eq(pdtpObjectives.programId, programId))
    const objectiveIdByCode = new Map(objectiveRows.map((objective) => [objective.code, objective.id]))

    const activityIdsByCode = new Map<string, string[]>()
    for (const row of plan.activityAssignments) {
      const list = activityIdsByCode.get(row.objectiveCode) ?? []
      list.push(row.activityId)
      activityIdsByCode.set(row.objectiveCode, list)
    }

    for (const [code, activityIds] of activityIdsByCode) {
      const objectiveId = objectiveIdByCode.get(code)
      if (!objectiveId) throw new Error(`El objetivo "${code}" no existe en el programa; falta crearlo antes de asignarlo.`)
      await db.update(pdtpActivities).set({ objectiveId, updatedAt: now }).where(inArray(pdtpActivities.id, activityIds))
    }
  }

  return {
    objectivesCreated: plan.objectivesToCreate.length,
    activitiesAssigned: plan.activityAssignments.length,
  }
}

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const program = programs.find((item) => item.status === "active") ?? programs.at(-1)
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  console.log(`Objetivos PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)
  console.log(`  Programa: ${program.id} (status=${program.status})`)
  console.log("")

  const plan = await planPdtp2026ObjectivesBackfill(program.id)

  if (plan.objectivesToCreate.length === 0) {
    console.log(`  · objetivos: sin cambios (ya existen los ${PDTP_2026_OBJECTIVES.length}).`)
  } else {
    console.log(`  ${DRY_RUN ? "◦ se crearían" : "✓"} ${plan.objectivesToCreate.length} objetivo(s) → ${plan.objectivesToCreate.map((o) => o.code).join(", ")}`)
  }

  if (plan.activityAssignments.length === 0) {
    console.log("  · actividades: sin cambios (ya tienen objetivo o su número no clasifica).")
  } else {
    console.log(`  ${DRY_RUN ? "◦ se asignarían" : "✓"} ${plan.activityAssignments.length} actividad(es)`)
  }

  console.log("")
  if (DRY_RUN) {
    console.log("[DRY RUN] no se escribió nada.")
  } else {
    const result = await applyPdtp2026ObjectivesPlan(program.id, plan)
    console.log(`Resumen: ${result.objectivesCreated} objetivo(s) creado(s), ${result.activitiesAssigned} actividad(es) asignada(s).`)
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
