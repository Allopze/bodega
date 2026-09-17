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

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
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
import { pdtpDeviationSchema, pdtpDeviationWithdrawSchema } from "@/lib/validation/prevention"
import {
  addPdtpChangeLogEntry,
  assertWorksiteAccess,
  isActivePdtpWorksite,
  isUniqueViolation,
  pdtpCellLockKey,
  type WorksiteScope,
} from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { currentPdtpPeriod, isPdtpPeriodOnOrAfterActivation } from "./period"
import { deriveScheduleHorizon } from "./recurrence"

export type PdtpDeviationKind = "not_performed" | "not_applicable" | "reprogrammed"

/** Etiqueta legible de cada tipo, para motivos y changelog (también la usa
 * `accreditation.ts` al retirar un desvío por evidencia). */
export const PDTP_DEVIATION_LABELS: Record<PdtpDeviationKind, string> = {
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
 * futuro; el destino de un `reprogrammed` cae dentro del año y del horizonte
 * del programa y pasa **las mismas** validaciones de período que el origen
 * (no anterior a la activación, actividad vigente ahí); y ninguno de los dos
 * primeros se declara sobre una celda que ya tiene una ejecución registrada
 * con cantidad > 0 —esto último dentro de la transacción y detrás del
 * advisory lock por celda, ver `pdtpCellLockKey`.
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

  // `not_applicable` y `reprogrammed` transforman el planificado, así que son
  // los dos que no pueden convivir con una ejecución en la misma celda.
  const requiresCellExclusivity = data.kind === "not_applicable" || data.kind === "reprogrammed"
  if (requiresCellExclusivity) {
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
      // El horizonte acota los MESES (un programa de período parcial no cubre
      // el año completo). No se compara la semana contra
      // `horizon.weeksPerMonth`: `deriveScheduleHorizon` se invoca con su
      // valor por defecto (4) y Zod ya acota `targetWeek` a 1–4, así que esa
      // comparación nunca podía ser falsa — era una validación aparente.
      const horizon = deriveScheduleHorizon(program)
      if (!horizon.months.includes(data.targetMonth!)) {
        throw new Error("El destino de la reprogramación debe caer dentro del año y del horizonte del programa.")
      }
      // El destino pasa LAS MISMAS validaciones de período que el origen. Sin
      // esto, reprogramar hacia atrás (antes de la activación) o hacia un
      // período donde la actividad ya está retirada pasaba todas las
      // validaciones y después cada consumidor —`filterPdtpRowsFromActivation`
      // en compliance/sheets/re36/management-report/constancias, y el filtro de
      // vigencia de `loadProgramScheduleAndExecutions`— borraba la celda
      // destino: el desvío decía "lo moví" y en realidad evaporaba planificado
      // del denominador.
      const target = { year: data.year, month: data.targetMonth!, week: data.targetWeek! }
      if (!isPdtpPeriodOnOrAfterActivation(target, program.activatedAt)) {
        throw new Error("El destino de la reprogramación es anterior a la activación del programa: esa celda no se exige y el planificado desaparecería del cálculo.")
      }
      if (!isPdtpActivityEffectiveForPeriod(activity, target.year, target.month, target.week)) {
        throw new Error("La actividad está retirada para el período de destino de la reprogramación: no se puede mover planificado a una celda que ya no se exige.")
      }
    }
  }

  const now = new Date().toISOString()
  const id = nanoid()
  try {
    return await db.transaction(async (tx) => {
      // TOCTOU con `markPdtpExecution`: la ejecución conflictiva se lee acá,
      // DENTRO de la transacción que inserta el desvío y detrás del mismo
      // advisory lock por celda que toma executions.ts, no antes y por fuera.
      // El `FOR UPDATE` bloquea la fila de ejecución si ya existe; el advisory
      // lock cubre el caso que el `FOR UPDATE` no puede cubrir —que la fila aún
      // no exista— y es lo que convierte la lectura en condición de escritura:
      // ninguna de las dos operaciones puede entrar mientras la otra está en
      // vuelo sobre la misma celda.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pdtpCellLockKey(data.activityId, data.worksiteId, data.year, data.month, data.week)}))`)
      if (requiresCellExclusivity) {
        const [conflictingExecution] = await tx.select({
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
        )).limit(1).for("update")
        if (conflictingExecution && conflictingExecution.executedQuantity > 0) {
          throw new Error("Ya hay una ejecución registrada en esta celda; no se puede declarar no aplicable ni reprogramar.")
        }
      }

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
        `Desvío "${PDTP_DEVIATION_LABELS[data.kind]}" registrado para actividad ${activity.n}. Motivo: ${data.reason}`,
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
 * Retira un desvío activo. La entrada se valida con
 * `pdtpDeviationWithdrawSchema` (motivo ≥10 caracteres, mismo mínimo que el
 * resto del módulo — reflejado en el CHECK
 * `pdtp_execution_deviations_withdrawn_check`).
 */
export async function withdrawPdtpDeviation(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
): Promise<void> {
  // La regla del motivo (≥10 caracteres, recortado) vive en el schema, no
  // duplicada acá: `pdtpDeviationWithdrawSchema` ya la declara y era código
  // muerto mientras esta función la validaba a mano.
  const { deviationId, reason } = pdtpDeviationWithdrawSchema.parse(input)

  await db.transaction(async (tx) => {
    const [deviation] = await tx.select().from(pdtpExecutionDeviations)
      .where(eq(pdtpExecutionDeviations.id, deviationId)).limit(1)
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
      eq(pdtpExecutionDeviations.id, deviationId),
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

/**
 * Tipo de un desvío por id, o `null` si no existe.
 *
 * Existe para que la capa de acciones pueda elegir el permiso del retiro
 * —`not_performed` lo retira quien ejecuta; los otros dos cambian lo
 * planificado y los retira quien administra metas— **leyendo la fila**, no
 * creyéndole al cliente. Un `kind` enviado por el formulario sería un permiso
 * elegido por quien lo pide.
 */
export async function getPdtpDeviationKind(deviationId: string): Promise<PdtpDeviationKind | null> {
  const [row] = await db.select({ kind: pdtpExecutionDeviations.kind })
    .from(pdtpExecutionDeviations)
    .where(eq(pdtpExecutionDeviations.id, deviationId))
    .limit(1)
  return (row?.kind as PdtpDeviationKind | undefined) ?? null
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
 *
 * ## Semántica: una celda descartada no vuelve
 *
 * Un destino de reprogramación puede caer sobre una celda que ya fue sacada
 * del denominador. La regla es que nada la reviva:
 *
 * - **Destino con `not_applicable` activo**: la cantidad movida se pierde.
 *   Alguien declaró que esa semana no se exige; devolverla al denominador con
 *   el planificado de otra celda contradiría esa declaración. El origen
 *   igualmente desaparece (el desvío se aplicó: el trabajo dejó de exigirse
 *   ahí).
 * - **Destino que es el origen de otro `reprogrammed`**: la cantidad sigue la
 *   cadena hasta el destino final, para no quedar depositada en una celda que
 *   el propio cálculo vacía un paso más adelante.
 * - **Cadena con ciclo**: no hay destino final que pueda exigir la cantidad,
 *   así que se descarta y todos los orígenes del ciclo salen igual.
 *
 * ## Destino no vigente (`isCellEffective`)
 *
 * `recordPdtpDeviation` ya no deja registrar una reprogramación hacia un
 * período donde la actividad está retirada o anterior a la activación del
 * programa. Pero un retiro declarado **después** del desvío puede dejar un
 * `reprogrammed` histórico apuntando a una celda que el filtro de vigencia de
 * `loadProgramScheduleAndExecutions` va a borrar: aplicarlo haría desaparecer
 * planificado legítimo del denominador sin dejar rastro.
 *
 * Por eso, cuando el caller entrega `isCellEffective`, un destino final no
 * vigente **aborta el desvío**: no se aplica y el origen conserva su
 * planificado donde estaba (sigue exigiéndose y, si no se hizo, cuenta como
 * incumplimiento). Es la opción conservadora —no perder planificado en
 * silencio— frente a la alternativa de dejarlo evaporarse. Es distinto del
 * caso `not_applicable`: ahí hay una declaración explícita de que la celda no
 * se exige; acá sólo hay un retiro posterior que invalidó el destino.
 */
export function applyDeviationsToSchedule<
  T extends {
    id: string
    activityId: string
    year: number
    month: number
    week: number
    plannedQuantity: number
    sourceColumn: string
  },
>(
  rows: T[],
  deviations: PdtpExecutionDeviation[],
  isCellEffective?: (activityId: string, month: number, week: number) => boolean,
): T[] {
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

  /**
   * Destino final de la cadena que arranca en `originKey`:
   * - `move`: la cantidad se deposita ahí;
   * - `discard`: se pierde, pero el origen igual sale del denominador;
   * - `abort`: el desvío no se aplica y el origen conserva su planificado.
   */
  type Resolution =
    | { kind: "move"; targetKey: string; activityId: string; month: number; week: number }
    | { kind: "discard" }
    | { kind: "abort" }

  const resolveFinalTarget = (originKey: string): Resolution => {
    const visited = new Set<string>([originKey])
    let deviation = reprogrammedByOrigin.get(originKey)!
    for (;;) {
      const month = deviation.targetMonth!
      const week = deviation.targetWeek!
      const targetKey = cellKey(deviation.activityId, month, week)
      if (isCellEffective && !isCellEffective(deviation.activityId, month, week)) return { kind: "abort" }
      if (notApplicableKeys.has(targetKey)) return { kind: "discard" }
      const next = reprogrammedByOrigin.get(targetKey)
      if (!next) return { kind: "move", targetKey, activityId: deviation.activityId, month, week }
      if (visited.has(targetKey)) return { kind: "discard" }
      visited.add(targetKey)
      deviation = next
    }
  }

  type Addition = { quantity: number; deviationIds: string[]; activityId: string; month: number; week: number }
  const additionsByTargetKey = new Map<string, Addition>()
  const consumedOriginKeys = new Set<string>()
  for (const [originKey, deviation] of reprogrammedByOrigin) {
    const resolution = resolveFinalTarget(originKey)
    if (resolution.kind === "abort") continue
    // El origen sale del denominador aunque la cantidad se descarte: el
    // desvío se aplicó, esa semana ya no exige nada.
    consumedOriginKeys.add(originKey)
    if (resolution.kind === "discard") continue
    const originRow = rowByKey.get(originKey)
    // Sin fila de origen ya no hay cantidad que mover (p. ej. un override
    // posterior la dejó en 0 y la fila desapareció del set efectivo, o el
    // filtro de vigencia ya borró la celda por retiro de la actividad).
    if (!originRow) continue
    const existing = additionsByTargetKey.get(resolution.targetKey)
    if (existing) {
      existing.quantity += originRow.plannedQuantity
      existing.deviationIds.push(deviation.id)
    } else {
      additionsByTargetKey.set(resolution.targetKey, {
        quantity: originRow.plannedQuantity,
        // Se traza el desvío que sacó la cantidad de su celda original; los
        // tramos intermedios de una cadena quedan trazados por los suyos.
        deviationIds: [deviation.id],
        activityId: resolution.activityId,
        month: resolution.month,
        week: resolution.week,
      })
    }
  }

  const producedTargetKeys = new Set<string>()
  const result: T[] = []

  for (const row of rows) {
    const key = cellKey(row.activityId, row.month, row.week)
    // Marcar como "ya producida" toda celda que este bucle descarta es lo que
    // impide que el bucle final la recree con la cantidad movida: una celda
    // fuera del denominador no vuelve por la puerta de atrás. Con la
    // resolución de cadenas de arriba ningún destino final cae acá, pero la
    // marca mantiene la invariante aunque esa resolución cambie.
    if (notApplicableKeys.has(key)) {
      producedTargetKeys.add(key) // elimina la celda: sale del denominador
      continue
    }
    if (consumedOriginKeys.has(key)) {
      producedTargetKeys.add(key) // el planificado se movió por completo al destino
      continue
    }
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
  // la misma actividad para conservar el resto de sus columnas (year…), que
  // esta función no conoce por ser genérica sobre T. El `id` NO se clona: se
  // sintetiza con el mismo formato determinista por celda que usa
  // `applyOverridesToSchedule` (overrides.ts), porque clonarlo devolvía dos
  // filas distintas con el mismo id en un mismo set.
  for (const [targetKey, addition] of additionsByTargetKey) {
    if (producedTargetKeys.has(targetKey)) continue
    const template = rows.find((row) => row.activityId === addition.activityId)
    if (!template) continue
    result.push({
      ...template,
      id: `${addition.activityId}-s-${template.year}-${String(addition.month).padStart(2, "0")}-${addition.week}`,
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
