/**
 * lib/services/pdtp/operational-handover.ts
 *
 * PREV-C05-D (T6): al activar una revisión v+1, la capa operacional que ya no
 * es de la versión anterior pasa a la nueva **en la misma transacción** que la
 * cierra. Son dos cosas:
 *
 * - **Asignaciones nominales**: `handoverPdtpWorksiteAssignees` (T0), sin
 *   cambios.
 * - **Desvíos abiertos** (`active` o `pending_review`) de la versión anterior
 *   cuya celda cae en la ventana de la nueva (desde su semana de activación):
 *   ahí ya no los cuenta nadie. Se copian a la actividad equivalente (mismo
 *   catálogo o, sin él, mismo número) con su tipo, motivo, estado y autor, y
 *   el original se retira con un motivo que nombra la versión. Una
 *   reprogramación cuyo **origen** sigue siendo de la versión anterior y cuyo
 *   destino es de la nueva se copia sin retirar el original: el origen sigue
 *   sacando el planificado de la versión anterior, y la copia lo deposita en
 *   la nueva.
 *
 * Cada copia pasa el mismo validador de celda que `recordPdtpDeviation`
 * (C07): actividad vigente y no excluida en la faena, faena que opera la
 * versión nueva, planificado efectivo en la celda para `not_applicable` y
 * `reprogrammed`, destino desde la activación, nada a futuro para
 * `not_applicable` y `not_performed`, sin ejecución registrada en la celda y
 * con el mes abierto. Lo que no pasa no se copia, se retira igual del original
 * (ya no es de su versión) y queda explicado en el control de cambios.
 *
 * **"No aplica" en revisión:** se traspasa **en revisión**, con quien lo
 * declaró. La celda es de la versión nueva, así que la revisión también: el
 * revisor lo encuentra en Aprobaciones bajo la v+1, y la segregación (quien
 * declaró no revisa) se conserva porque el autor viaja con la copia. Revisarlo
 * sobre la versión anterior aprobaría una exclusión en una semana que esa
 * versión ya no mide. Un N/A ya aprobado viaja aprobado, con su revisión.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpActivityWorksiteExclusions,
  pdtpExecutionDeviations,
  pdtpExecutions,
  pdtpPrograms,
  type PdtpExecutionDeviation,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addPdtpChangeLogEntry } from "./helpers"
import { handoverPdtpWorksiteAssignees } from "./assignees"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { currentPdtpPeriod, isPdtpPeriodOnOrAfterActivation, type PdtpPeriod } from "./period"
import { assertPdtpPeriodOpen } from "./period-guard"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { comparePdtpPeriods } from "./version-window"

export type PdtpOperationalHandoverResult = {
  assignees: number
  deviations: {
    handed: number
    skipped: Array<{ deviationId: string; reason: string }>
  }
}

type ActivityIdentity = { id: string; n: number; catalogActivityId: string | null }

/** La actividad equivalente en la versión nueva: mismo catálogo o, sin él, mismo número. */
export function mapPdtpActivitiesByIdentity(source: ActivityIdentity[], target: ActivityIdentity[]): Map<string, string | undefined> {
  const targetByCatalog = new Map(target.filter((row) => row.catalogActivityId).map((row) => [row.catalogActivityId!, row.id]))
  const targetByN = new Map(target.map((row) => [row.n, row.id]))
  return new Map(source.map((row) => [
    row.id,
    (row.catalogActivityId ? targetByCatalog.get(row.catalogActivityId) : undefined) ?? targetByN.get(row.n),
  ]))
}

function isCellInFuture(cell: PdtpPeriod, current: PdtpPeriod): boolean {
  return comparePdtpPeriods(cell, current) > 0
}

export async function handoverPdtpOperationalLayer(
  fromProgramIds: string[],
  toProgramId: string,
  context: { today: string; userId: string; activatedAt: string },
  tx: Tx,
): Promise<PdtpOperationalHandoverResult> {
  const assignees = await handoverPdtpWorksiteAssignees(fromProgramIds, toProgramId, context.today, tx)
  const empty = { assignees, deviations: { handed: 0, skipped: [] } }
  if (fromProgramIds.length === 0) return empty

  const [target] = await tx.select({ id: pdtpPrograms.id, year: pdtpPrograms.year, version: pdtpPrograms.version })
    .from(pdtpPrograms).where(eq(pdtpPrograms.id, toProgramId)).limit(1)
  if (!target) return empty
  const activation = currentPdtpPeriod(new Date(context.activatedAt))
  const now = currentPdtpPeriod()

  const [sourceActivities, targetActivities] = await Promise.all([
    tx.select({ id: pdtpActivities.id, n: pdtpActivities.n, catalogActivityId: pdtpActivities.catalogActivityId })
      .from(pdtpActivities).where(inArray(pdtpActivities.programId, fromProgramIds)),
    tx.select().from(pdtpActivities).where(and(eq(pdtpActivities.programId, toProgramId), eq(pdtpActivities.status, "active"))),
  ])
  if (sourceActivities.length === 0) return empty
  const targetFor = mapPdtpActivitiesByIdentity(sourceActivities, targetActivities)
  const targetById = new Map(targetActivities.map((row) => [row.id, row]))

  const open = (await tx.select().from(pdtpExecutionDeviations).where(and(
    inArray(pdtpExecutionDeviations.activityId, sourceActivities.map((row) => row.id)),
    eq(pdtpExecutionDeviations.year, target.year),
    inArray(pdtpExecutionDeviations.status, ["active", "pending_review"]),
  ))).filter((row) => {
    const sourceInNew = comparePdtpPeriods(row, activation) >= 0
    const targetInNew = row.kind === "reprogrammed" && row.targetMonth !== null && row.targetWeek !== null
      && comparePdtpPeriods({ year: row.year, month: row.targetMonth, week: row.targetWeek }, activation) >= 0
    return sourceInNew || targetInNew
  })
  if (open.length === 0) return empty

  const skipped: Array<{ deviationId: string; reason: string }> = []
  let handed = 0
  const withdrawReason = `Traspasado a la versión v${target.version} al activarse: la semana ya es de esa versión.`

  for (const deviation of open) {
    const sourceInNew = comparePdtpPeriods(deviation, activation) >= 0
    const outcome = await copyDeviationToTarget(tx, deviation, {
      targetActivityId: targetFor.get(deviation.activityId),
      targetById,
      toProgramId,
      targetYear: target.year,
      activatedAt: context.activatedAt,
      now,
    })
    if (outcome.kind === "skipped") skipped.push({ deviationId: deviation.id, reason: outcome.reason })
    if (outcome.kind === "copied") handed += 1
    // El original deja de describir algo que su versión mida: se retira. La
    // reprogramación con origen propio sigue vigente (su origen es de v1).
    if (sourceInNew) {
      await tx.update(pdtpExecutionDeviations).set({
        status: "withdrawn",
        withdrawnByUserId: context.userId,
        withdrawnAt: new Date().toISOString(),
        withdrawReason: outcome.kind === "skipped" ? `${withdrawReason} No se copió: ${outcome.reason}` : withdrawReason,
      }).where(and(eq(pdtpExecutionDeviations.id, deviation.id), inArray(pdtpExecutionDeviations.status, ["active", "pending_review"])))
    }
  }

  if (handed > 0 || skipped.length > 0) {
    const skippedNote = skipped.length > 0
      ? ` No se copiaron ${skipped.length}: ${skipped.map((entry) => entry.reason).join("; ")}.`
      : ""
    await addPdtpChangeLogEntry(
      toProgramId, target.version, context.userId, "handover",
      null,
      { deviations: handed, skipped, assignees },
      `Al activarse la versión v${target.version} se traspasaron ${handed} desvíos abiertos de la versión anterior cuya semana ya es de esta versión.${skippedNote}`,
      tx,
    )
  }
  return { assignees, deviations: { handed, skipped } }
}

type CopyOutcome = { kind: "copied" } | { kind: "already" } | { kind: "skipped"; reason: string }

async function copyDeviationToTarget(
  tx: Tx,
  deviation: PdtpExecutionDeviation,
  context: {
    targetActivityId: string | undefined
    targetById: Map<string, typeof pdtpActivities.$inferSelect>
    toProgramId: string
    targetYear: number
    activatedAt: string
    now: PdtpPeriod
  },
): Promise<CopyOutcome> {
  const cell = { year: deviation.year, month: deviation.month, week: deviation.week }
  const where = `semana ${deviation.week} de ${deviation.month}/${deviation.year}`
  const activity = context.targetActivityId ? context.targetById.get(context.targetActivityId) : undefined
  if (!activity) return { kind: "skipped", reason: `la actividad ya no existe en la versión nueva (${where})` }

  // Ya traspasado antes (la reprogramación con origen propio se vuelve a
  // encontrar en cada activación): no es un rechazo, es idempotencia.
  const [openInTarget] = await tx.select().from(pdtpExecutionDeviations).where(and(
    eq(pdtpExecutionDeviations.activityId, activity.id),
    eq(pdtpExecutionDeviations.worksiteId, deviation.worksiteId),
    eq(pdtpExecutionDeviations.year, deviation.year),
    eq(pdtpExecutionDeviations.month, deviation.month),
    eq(pdtpExecutionDeviations.week, deviation.week),
    inArray(pdtpExecutionDeviations.status, ["active", "pending_review"]),
  )).limit(1)
  if (openInTarget) {
    return openInTarget.kind === deviation.kind
      && openInTarget.targetMonth === deviation.targetMonth
      && openInTarget.targetWeek === deviation.targetWeek
      ? { kind: "already" }
      : { kind: "skipped", reason: `la celda ya tiene otro desvío en la versión nueva (${where})` }
  }

  try {
    await assertPdtpWorksiteCanOperateProgram(context.toProgramId, deviation.worksiteId, tx)
  } catch {
    return { kind: "skipped", reason: `la faena no opera la versión nueva (${where})` }
  }
  if (!isPdtpActivityEffectiveForPeriod(activity, cell.year, cell.month, cell.week)) {
    return { kind: "skipped", reason: `la actividad N°${activity.n} está retirada en la versión nueva (${where})` }
  }
  const [exclusion] = await tx.select({ id: pdtpActivityWorksiteExclusions.id }).from(pdtpActivityWorksiteExclusions)
    .where(and(eq(pdtpActivityWorksiteExclusions.activityId, activity.id), eq(pdtpActivityWorksiteExclusions.worksiteId, deviation.worksiteId)))
    .limit(1)
  if (exclusion) return { kind: "skipped", reason: `la actividad N°${activity.n} está excluida en esa faena en la versión nueva (${where})` }
  if (deviation.kind !== "reprogrammed" && isCellInFuture(cell, context.now)) {
    return { kind: "skipped", reason: `la semana todavía no ocurre (${where})` }
  }

  if (deviation.kind === "not_applicable" || deviation.kind === "reprogrammed") {
    const [scheduleRows, overrideRows] = await Promise.all([
      tx.select().from(pdtpActivitySchedule).where(and(eq(pdtpActivitySchedule.activityId, activity.id), eq(pdtpActivitySchedule.year, cell.year))),
      loadPdtpOverrides([activity.id], cell.year, deviation.worksiteId, tx),
    ])
    const planned = applyOverridesToSchedule(scheduleRows, overrideRows)
      .find((row) => row.month === cell.month && row.week === cell.week)?.plannedQuantity ?? 0
    if (planned <= 0) return { kind: "skipped", reason: `la versión nueva no planifica esa semana (${where})` }
  }
  if (deviation.kind === "reprogrammed") {
    const destination = { year: cell.year, month: deviation.targetMonth!, week: deviation.targetWeek! }
    if (!isPdtpPeriodOnOrAfterActivation(destination, context.activatedAt)
      || !isPdtpActivityEffectiveForPeriod(activity, destination.year, destination.month, destination.week)) {
      return { kind: "skipped", reason: `el destino de la reprogramación no se exige en la versión nueva (${where})` }
    }
  }

  const [execution] = await tx.select({ executedQuantity: pdtpExecutions.executedQuantity }).from(pdtpExecutions).where(and(
    eq(pdtpExecutions.activityId, activity.id),
    eq(pdtpExecutions.worksiteId, deviation.worksiteId),
    eq(pdtpExecutions.year, cell.year),
    eq(pdtpExecutions.month, cell.month),
    eq(pdtpExecutions.week, cell.week),
    isNull(pdtpExecutions.obligationId),
    or(eq(pdtpExecutions.status, "submitted"), eq(pdtpExecutions.status, "approved")),
  )).limit(1)
  if (execution && execution.executedQuantity > 0) {
    return { kind: "skipped", reason: `la celda ya tiene una ejecución en la versión nueva (${where})` }
  }

  try {
    await assertPdtpPeriodOpen(context.toProgramId, deviation.worksiteId, cell.year, cell.month, tx)
    if (deviation.kind === "reprogrammed") {
      await assertPdtpPeriodOpen(context.toProgramId, deviation.worksiteId, cell.year, deviation.targetMonth!, tx)
    }
  } catch {
    return { kind: "skipped", reason: `el mes está cerrado en la versión nueva (${where})` }
  }

  await tx.insert(pdtpExecutionDeviations).values({
    id: nanoid(),
    activityId: activity.id,
    worksiteId: deviation.worksiteId,
    year: deviation.year,
    month: deviation.month,
    week: deviation.week,
    kind: deviation.kind,
    reason: deviation.reason,
    targetMonth: deviation.targetMonth,
    targetWeek: deviation.targetWeek,
    status: deviation.status,
    createdByUserId: deviation.createdByUserId,
    createdAt: deviation.createdAt,
    reviewedByUserId: deviation.reviewedByUserId,
    reviewedAt: deviation.reviewedAt,
    reviewReason: deviation.reviewReason,
  })
  return { kind: "copied" }
}
