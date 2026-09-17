/**
 * lib/services/pdtp/deviations.ts
 *
 * Desvíos declarados sobre una celda (actividad × faena × año/mes/semana) del
 * calendario PDTP. Tres tipos, tres efectos distintos sobre el planificado:
 *
 * - `not_applicable`: la celda no se exige esta semana. Sale del denominador.
 * - `reprogrammed`: el planificado se traslada a otra celda (mismo año,
 *   dentro del horizonte del programa), sumándose si el destino ya tenía algo.
 * - `not_performed`: no toca el planificado. La celda se sigue exigiendo; lo
 *   que cambia es que hay un motivo declarado para el "no ejecutado", no que
 *   deje de contar como tal.
 *
 * `applyDeviationsToSchedule` es la única función que transforma el
 * calendario por desvíos, y `loadProgramScheduleAndExecutions` (helpers.ts)
 * es el único punto que la invoca — después de aplicar overrides y
 * exclusiones por faena. Todo lo que lee planificado/ejecutado a través de
 * esa función (indicador de cumplimiento, vista de hojas, reporte de
 * gestión, RE-36, recordatorios, constancias) hereda el efecto sin tocar
 * nada más.
 *
 * Los desvíos NO entran en la huella firmada (`content-digest.ts`): son un
 * ajuste operacional posterior a la firma, igual que los overrides de meta
 * por faena. Su traza vive en `pdtp_change_log`, sección `deviation:{n}`.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpActivityWorksiteExclusions,
  pdtpExecutionDeviations,
  pdtpExecutions,
  pdtpPrograms,
  users,
  type PdtpExecutionDeviation,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { pdtpDeviationSchema } from "@/lib/validation/prevention"
import {
  addPdtpChangeLogEntry,
  assertWorksiteAccess,
  isActivePdtpWorksite,
  isUniqueViolation,
  type WorksiteScope,
} from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { currentPdtpPeriod, isPdtpPeriodOnOrAfterActivation } from "./period"
import { deriveScheduleHorizon } from "./recurrence"

export type PdtpDeviationKind = "not_performed" | "not_applicable" | "reprogrammed"

const DEVIATION_LABELS: Record<PdtpDeviationKind, string> = {
  not_performed: "no realizado",
  not_applicable: "no aplicable",
  reprogrammed: "reprogramado",
}

/**
 * Registra un desvío sobre una celda. Valida, en orden: la faena existe y
 * está activa; el usuario tiene alcance sobre ella; la actividad y el
 * programa existen y el programa está activo; la faena está habilitada para
 * operar el programa; el período corresponde al año del programa y no es
 * anterior a su activación; la actividad sigue vigente (no retirada) para
 * ese período; la actividad no está excluida en esa faena; para
 * `not_applicable`/`reprogrammed`, la celda tiene planificado efectivo > 0
 * (override si existe, si no el catálogo); `not_performed` no se declara a
 * futuro; `reprogrammed` cae dentro del año y del horizonte del programa; y
 * ninguno de los dos primeros se declara sobre una celda que ya tiene una
 * ejecución registrada con cantidad > 0.
 *
 * La unicidad de un desvío activo por celda la impone el índice parcial de
 * `pdtp_execution_deviations` (WHERE status = 'active'); acá sólo se traduce
 * su violación a un mensaje legible.
 */
export async function recordPdtpDeviation(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
): Promise<PdtpExecutionDeviation> {
  const data = pdtpDeviationSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  if (!await isActivePdtpWorksite(data.worksiteId)) {
    throw new Error("La faena no existe o está inactiva.")
  }

  const [activity] = await db.select({
    programId: pdtpActivities.programId,
    n: pdtpActivities.n,
    status: pdtpActivities.status,
    retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
  }).from(pdtpActivities).where(eq(pdtpActivities.id, data.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select({
    status: pdtpPrograms.status,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    activatedAt: pdtpPrograms.activatedAt,
    periodStart: pdtpPrograms.periodStart,
    periodEnd: pdtpPrograms.periodEnd,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") {
    throw new Error("Solo se pueden registrar desvíos sobre programas PDTP en estado activo.")
  }

  // Si el programa declara membresía de faenas, una faena fuera de ella no
  // puede declarar desvíos (mismo guard que overrides/ejecuciones).
  await assertPdtpWorksiteCanOperateProgram(activity.programId, data.worksiteId)

  if (program.year !== data.year) {
    throw new Error(`El desvío debe corresponder al año del programa (${program.year}).`)
  }
  if (!isPdtpPeriodOnOrAfterActivation(data, program.activatedAt)) {
    throw new Error("El programa aún no estaba activo en el período seleccionado.")
  }
  if (!isPdtpActivityEffectiveForPeriod(activity, data.year, data.month, data.week)) {
    throw new Error("La actividad está retirada para el período seleccionado y no admite desvíos.")
  }

  const [exclusion] = await db.select({ id: pdtpActivityWorksiteExclusions.id })
    .from(pdtpActivityWorksiteExclusions)
    .where(and(
      eq(pdtpActivityWorksiteExclusions.activityId, data.activityId),
      eq(pdtpActivityWorksiteExclusions.worksiteId, data.worksiteId),
    ))
    .limit(1)
  if (exclusion) throw new Error("La actividad está excluida para esta faena y no admite desvíos.")

  if (data.kind === "not_performed") {
    const current = currentPdtpPeriod()
    const isFuturePeriod = data.year > current.year
      || (data.year === current.year && data.month > current.month)
      || (data.year === current.year && data.month === current.month && data.week > current.week)
    if (isFuturePeriod) {
      throw new Error("No se puede declarar 'no realizado' para un período que aún no ocurre.")
    }
  }

  if (data.kind === "not_applicable" || data.kind === "reprogrammed") {
    const [scheduleRows, overrideRows] = await Promise.all([
      db.select().from(pdtpActivitySchedule).where(and(
        eq(pdtpActivitySchedule.activityId, data.activityId),
        eq(pdtpActivitySchedule.year, data.year),
      )),
      loadPdtpOverrides([data.activityId], data.year, data.worksiteId),
    ])
    const effectiveSchedule = applyOverridesToSchedule(scheduleRows, overrideRows)
    const cell = effectiveSchedule.find((row) => row.month === data.month && row.week === data.week)
    const effectivePlanned = cell?.plannedQuantity ?? 0
    if (effectivePlanned <= 0) {
      throw new Error("No hay planificación efectiva en esta celda: no hay nada que declarar no aplicable ni que reprogramar.")
    }

    if (data.kind === "reprogrammed") {
      const horizon = deriveScheduleHorizon(program)
      if (!horizon.months.includes(data.targetMonth!) || data.targetWeek! > horizon.weeksPerMonth) {
        throw new Error("El destino de la reprogramación debe caer dentro del año y del horizonte del programa.")
      }
    }

    const [conflictingExecution] = await db.select({
      id: pdtpExecutions.id,
      executedQuantity: pdtpExecutions.executedQuantity,
    }).from(pdtpExecutions).where(and(
      eq(pdtpExecutions.activityId, data.activityId),
      eq(pdtpExecutions.worksiteId, data.worksiteId),
      eq(pdtpExecutions.year, data.year),
      eq(pdtpExecutions.month, data.month),
      eq(pdtpExecutions.week, data.week),
      isNull(pdtpExecutions.obligationId),
      inArray(pdtpExecutions.status, ["submitted", "approved"]),
    )).limit(1)
    if (conflictingExecution && conflictingExecution.executedQuantity > 0) {
      throw new Error("Ya hay una ejecución registrada en esta celda; no se puede declarar no aplicable ni reprogramar.")
    }
  }

  const now = new Date().toISOString()
  const id = nanoid()
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(pdtpExecutionDeviations).values({
        id,
        activityId: data.activityId,
        worksiteId: data.worksiteId,
        year: data.year,
        month: data.month,
        week: data.week,
        kind: data.kind,
        reason: data.reason,
        targetMonth: data.kind === "reprogrammed" ? data.targetMonth! : null,
        targetWeek: data.kind === "reprogrammed" ? data.targetWeek! : null,
        status: "active",
        createdByUserId: userId,
        createdAt: now,
      }).returning()
      if (!row) throw new Error("No se pudo registrar el desvío PDTP.")

      await addPdtpChangeLogEntry(
        activity.programId, program.version, userId, `deviation:${activity.n}`,
        null,
        {
          worksiteId: data.worksiteId, year: data.year, month: data.month, week: data.week,
          kind: data.kind, reason: data.reason, targetMonth: row.targetMonth, targetWeek: row.targetWeek,
        },
        `Desvío "${DEVIATION_LABELS[data.kind]}" registrado para actividad ${activity.n}. Motivo: ${data.reason}`,
        tx,
      )
      return row
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new Error("Ya existe un desvío activo para esta celda. Retíralo antes de registrar uno nuevo.")
    }
    throw e
  }
}

/**
 * Retira un desvío activo. Requiere motivo (mismo mínimo que el resto del
 * módulo, ≥10 caracteres — reflejado en el CHECK
 * `pdtp_execution_deviations_withdrawn_check`).
 */
export async function withdrawPdtpDeviation(
  input: { deviationId: string; reason: string },
  userId: string,
  scope: WorksiteScope,
): Promise<void> {
  const reason = input.reason?.trim() ?? ""
  if (reason.length < 10) throw new Error("El motivo del retiro debe tener al menos 10 caracteres.")

  await db.transaction(async (tx) => {
    const [deviation] = await tx.select().from(pdtpExecutionDeviations)
      .where(eq(pdtpExecutionDeviations.id, input.deviationId)).limit(1)
    if (!deviation) throw new Error("Desvío PDTP no encontrado.")
    assertWorksiteAccess(deviation.worksiteId, scope)
    if (deviation.status !== "active") throw new Error("El desvío ya fue retirado.")

    const [activity] = await tx.select({ programId: pdtpActivities.programId, n: pdtpActivities.n })
      .from(pdtpActivities).where(eq(pdtpActivities.id, deviation.activityId)).limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada.")
    const [program] = await tx.select({ version: pdtpPrograms.version })
      .from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")

    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpExecutionDeviations).set({
      status: "withdrawn",
      withdrawnByUserId: userId,
      withdrawnAt: now,
      withdrawReason: reason,
    }).where(and(
      eq(pdtpExecutionDeviations.id, input.deviationId),
      eq(pdtpExecutionDeviations.status, "active"),
    )).returning()
    if (!updated) throw new Error("El desvío cambió de estado antes de poder retirarse. Actualiza la página e inténtalo nuevamente.")

    await addPdtpChangeLogEntry(
      activity.programId, program.version, userId, `deviation:${activity.n}`,
      { status: "active", kind: deviation.kind, month: deviation.month, week: deviation.week },
      { status: "withdrawn", reason },
      `Desvío retirado para actividad ${activity.n}. Motivo: ${reason}`,
      tx,
    )
  })
}

/** Desvíos activos de un set de actividades para una faena y año. */
export async function loadPdtpDeviations(
  activityIds: string[],
  year: number,
  worksiteId: string,
): Promise<PdtpExecutionDeviation[]> {
  if (activityIds.length === 0) return []
  return db.select().from(pdtpExecutionDeviations).where(and(
    inArray(pdtpExecutionDeviations.activityId, activityIds),
    eq(pdtpExecutionDeviations.worksiteId, worksiteId),
    eq(pdtpExecutionDeviations.year, year),
    eq(pdtpExecutionDeviations.status, "active"),
  ))
}

/**
 * Aplica los desvíos activos a un calendario ya resuelto por
 * `loadProgramScheduleAndExecutions` (overrides + exclusiones ya aplicados).
 * Pura: no consulta la base de datos, sólo transforma filas. Los desvíos
 * `withdrawn` (o cualquier estado distinto de `active`) se ignoran, para que
 * un caller que pase el historial completo por error no altere el cálculo.
 *
 * - `not_applicable`: elimina la celda.
 * - `reprogrammed`: mueve `plannedQuantity` completo de la celda de origen a
 *   (targetMonth, targetWeek), sumando si el destino ya tenía planificado.
 *   La celda origen desaparece (su planificado ya no exige nada esa
 *   semana); el destino queda marcado con `sourceColumn: "deviation:<id>"`
 *   para poder rastrear que ese número no es el original del catálogo.
 * - `not_performed`: no toca ninguna celda.
 */
export function applyDeviationsToSchedule<
  T extends { activityId: string; month: number; week: number; plannedQuantity: number; sourceColumn: string },
>(rows: T[], deviations: PdtpExecutionDeviation[]): T[] {
  const active = deviations.filter((d) => d.status === "active")
  if (active.length === 0) return rows

  const cellKey = (activityId: string, month: number, week: number) => `${activityId}::${month}::${week}`

  const notApplicableKeys = new Set<string>()
  const reprogrammedByOrigin = new Map<string, PdtpExecutionDeviation>()
  for (const deviation of active) {
    const key = cellKey(deviation.activityId, deviation.month, deviation.week)
    if (deviation.kind === "not_applicable") notApplicableKeys.add(key)
    else if (deviation.kind === "reprogrammed") reprogrammedByOrigin.set(key, deviation)
    // "not_performed" no transforma el calendario.
  }
  if (notApplicableKeys.size === 0 && reprogrammedByOrigin.size === 0) return rows

  const rowByKey = new Map<string, T>()
  for (const row of rows) rowByKey.set(cellKey(row.activityId, row.month, row.week), row)

  type Addition = { quantity: number; deviationIds: string[]; activityId: string; month: number; week: number }
  const additionsByTargetKey = new Map<string, Addition>()
  for (const [originKey, deviation] of reprogrammedByOrigin) {
    const originRow = rowByKey.get(originKey)
    // Sin fila de origen ya no hay cantidad que mover (p. ej. un override
    // posterior la dejó en 0 y la fila desapareció del set efectivo).
    if (!originRow) continue
    const targetKey = cellKey(deviation.activityId, deviation.targetMonth!, deviation.targetWeek!)
    const existing = additionsByTargetKey.get(targetKey)
    if (existing) {
      existing.quantity += originRow.plannedQuantity
      existing.deviationIds.push(deviation.id)
    } else {
      additionsByTargetKey.set(targetKey, {
        quantity: originRow.plannedQuantity,
        deviationIds: [deviation.id],
        activityId: deviation.activityId,
        month: deviation.targetMonth!,
        week: deviation.targetWeek!,
      })
    }
  }

  const consumedOriginKeys = new Set(reprogrammedByOrigin.keys())
  const producedTargetKeys = new Set<string>()
  const result: T[] = []

  for (const row of rows) {
    const key = cellKey(row.activityId, row.month, row.week)
    if (notApplicableKeys.has(key)) continue // elimina la celda: sale del denominador
    if (consumedOriginKeys.has(key)) continue // el planificado se movió por completo al destino
    const addition = additionsByTargetKey.get(key)
    if (addition) {
      producedTargetKeys.add(key)
      result.push({
        ...row,
        plannedQuantity: row.plannedQuantity + addition.quantity,
        sourceColumn: `deviation:${addition.deviationIds.join(",")}`,
      })
      continue
    }
    result.push(row)
  }

  // Destinos que no tenían fila propia: se crean clonando cualquier fila de
  // la misma actividad para conservar el resto de sus columnas (id, year…),
  // que esta función no conoce por ser genérica sobre T.
  for (const [targetKey, addition] of additionsByTargetKey) {
    if (producedTargetKeys.has(targetKey)) continue
    const template = rows.find((row) => row.activityId === addition.activityId)
    if (!template) continue
    result.push({
      ...template,
      month: addition.month,
      week: addition.week,
      plannedQuantity: addition.quantity,
      sourceColumn: `deviation:${addition.deviationIds.join(",")}`,
    })
  }

  return result
}

/** Conteo de desvíos activos por actividad y mes, para insignias de UI. */
export function deviationsByActivityMonth(
  deviations: PdtpExecutionDeviation[],
): Map<string, { notPerformed: number; notApplicable: number; reprogrammed: number }> {
  const result = new Map<string, { notPerformed: number; notApplicable: number; reprogrammed: number }>()
  for (const deviation of deviations) {
    if (deviation.status !== "active") continue
    const key = `${deviation.activityId}::${deviation.month}`
    const entry = result.get(key) ?? { notPerformed: 0, notApplicable: 0, reprogrammed: 0 }
    if (deviation.kind === "not_performed") entry.notPerformed += 1
    else if (deviation.kind === "not_applicable") entry.notApplicable += 1
    else entry.reprogrammed += 1
    result.set(key, entry)
  }
  return result
}

/** Desvíos (cualquier estado) de un programa/faena, con datos para listar en UI. */
export async function listPdtpDeviationsForProgram(
  programId: string,
  worksiteId: string,
  scope: WorksiteScope,
): Promise<Array<PdtpExecutionDeviation & { activityN: number; activityName: string; userName: string }>> {
  assertWorksiteAccess(worksiteId, scope)
  const rows = await db.select({
    deviation: pdtpExecutionDeviations,
    activityN: pdtpActivities.n,
    activityName: pdtpActivities.activity,
    userName: users.name,
  }).from(pdtpExecutionDeviations)
    .innerJoin(pdtpActivities, eq(pdtpExecutionDeviations.activityId, pdtpActivities.id))
    .innerJoin(users, eq(pdtpExecutionDeviations.createdByUserId, users.id))
    .where(and(
      eq(pdtpActivities.programId, programId),
      eq(pdtpExecutionDeviations.worksiteId, worksiteId),
    ))
    .orderBy(desc(pdtpExecutionDeviations.createdAt))
  return rows.map(({ deviation, activityN, activityName, userName }) => ({
    ...deviation, activityN, activityName, userName,
  }))
}
