/**
 * lib/services/pdtp-adapters/slot-deviation-connector.ts
 *
 * Conector entre las casillas del programa de los submódulos (alcotest,
 * simulacros, sesiones del CGRD, ocurrencias de capacitación) y los desvíos
 * por celda del PDTP (`pdtp_execution_deviations`).
 *
 * Una casilla declarada «no aplica» o «no hecha» es la fuente de verdad del
 * submódulo; el PDTP es un consumidor. Antes de este conector el estado nunca
 * llegaba: la celda seguía planificada y en cero, así que contaba como
 * incumplimiento aunque la pantalla de la casilla prometiera que la actividad
 * salía del programa. Ahora cada cambio de estado de la casilla se refleja en
 * su celda con `recordPdtpDeviation` —la única función que escribe esa tabla;
 * este archivo no reimplementa ninguna de sus validaciones—:
 *
 * - `not_applicable` → desvío `not_applicable` (la celda sale del denominador);
 * - `not_completed` → desvío `not_performed` (la celda se sigue exigiendo; lo
 *   que queda es el motivo declarado).
 *
 * **Tolerante a fallos, y sin tumbar la transacción de la casilla.** Sin
 * programa activo, con la actividad excluida en la faena, sin planificado en
 * la celda, con el mes cerrado o con un `not_performed` a futuro, el PDTP
 * rechaza el desvío: eso queda en el log y la casilla cambia igual. Cada
 * escritura va en su propio SAVEPOINT (`tx.transaction` sobre la
 * transacción de la casilla), porque un error de SQL dentro de una
 * transacción la deja abortada entera — atrapar la excepción en JS no basta.
 *
 * **Permiso.** No se pide `prevention:pdtp:*`: quien llega acá ya pasó el
 * permiso de su propio dominio (`prevention:alcotest:register`,
 * `prevention:emergency:drill_execute`, `prevention:cgrd:meeting:manage`,
 * `prevention:training:record`), que es lo que autorizó cambiar la casilla. La
 * vía manual desde la planilla del PDTP sigue exigiendo el suyo
 * (`app/(app)/prevencion/pdtp/actions/deviations.ts`).
 *
 * **Lo que la casilla propagó, lo retira la casilla — y nada más.** Cuando la
 * casilla pasa de «no aplica» a «no hecha» (o al revés), el desvío que ella
 * misma escribió antes ya no dice la verdad: se retira y se escribe el nuevo.
 * Se reconoce por tipo y motivo idénticos a los que la casilla declaraba antes
 * del cambio (`previous`), porque la tabla no guarda el origen del desvío. Un
 * desvío que no coincide lo declaró alguien desde la planilla del PDTP con
 * `override:manage`, y este conector no lo pisa: lo deja y avisa en el log.
 */

import { and, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { pdtpActivities, pdtpExecutionDeviations } from "@/db/schema"
import { logger } from "@/lib/logger"
import { PdtpNoActiveProgramError, resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import { recordPdtpDeviation, withdrawPdtpDeviation } from "@/lib/services/pdtp/deviations"

/** Lo que una casilla declara hacia su celda del PDTP. */
export type SlotPdtpDeclaration = {
  kind: "not_applicable" | "not_performed"
  reason: string
}

/** El estado en el vocabulario de la casilla, para el motivo del retiro. */
const SLOT_STATUS_LABELS: Record<SlotPdtpDeclaration["kind"], string> = {
  not_applicable: "no aplica",
  not_performed: "no hecha",
}

/** Mismo máximo que `pdtpDeviationSchema.reason`. */
const DEVIATION_REASON_MAX = 1000
/** Mismo mínimo que `pdtpDeviationSchema.reason` y el CHECK de la tabla. */
const DEVIATION_REASON_MIN = 10

function fitReason(text: string): string {
  return text.length > DEVIATION_REASON_MAX ? `${text.slice(0, DEVIATION_REASON_MAX - 1).trimEnd()}…` : text
}

/**
 * Qué declara una casilla al PDTP según su fila, o `null` si su estado no se
 * propaga (`pending`, `completed`: el cumplimiento lo lleva el motor de
 * acreditación, que además retira el desvío de la celda que acredita).
 *
 * **Tiene que ser una función pura de la fila.** Se aplica a la fila nueva
 * para saber qué escribir y a la fila anterior para reconocer el desvío que la
 * propia casilla escribió la vez pasada; si dependiera de la hora o del
 * usuario, esa segunda lectura no coincidiría nunca.
 *
 * - «No aplica»: el motivo de la casilla, textual (ya trae ≥10 caracteres: lo
 *   exige el CHECK de cada tabla de casillas).
 * - «No hecha»: la observación, si alcanza el mínimo del PDTP; si no —es
 *   opcional en la casilla—, un motivo que nombra la casilla y conserva la
 *   observación corta cuando la hay.
 *
 * @param label Cómo se nombra la casilla en el motivo: «de simulacro m03-w3».
 */
export function slotPdtpDeclaration(
  slot: { status: string; notApplicableReason: string | null; observation: string | null },
  label: string,
): SlotPdtpDeclaration | null {
  if (slot.status === "not_applicable") {
    const reason = slot.notApplicableReason?.trim() ?? ""
    return {
      kind: "not_applicable",
      reason: reason.length >= DEVIATION_REASON_MIN
        ? fitReason(reason)
        : `Casilla ${label} declarada no aplicable en su submódulo.`,
    }
  }
  if (slot.status === "not_completed") {
    const observation = slot.observation?.trim() ?? ""
    return {
      kind: "not_performed",
      reason: observation.length >= DEVIATION_REASON_MIN
        ? fitReason(observation)
        : `Casilla ${label} marcada como no hecha en su submódulo.${observation ? ` Observación: ${observation}` : ""}`,
    }
  }
  return null
}

export interface SlotPdtpPropagationInput {
  /** Para el log y para el motivo del retiro. */
  source: { module: string; slotId: string; label: string }
  worksiteId: string
  /** La celda de la casilla. Sin mes/semana (actividad anual) no hay celda. */
  cell: { year: number; month: number | null; week: number | null }
  /**
   * Las actividades PDTP de la familia de la casilla: donde se escribe el
   * desvío nuevo y donde puede haber quedado el que la casilla escribió antes.
   */
  activities: { activityNumbers: readonly number[] } | { catalogActivityIds: readonly string[] }
  /**
   * Sobre cuáles de esas actividades se declara el estado nuevo, por número.
   * Omitido: todas. Existe por la N°30/N°31, una sola serie de casillas donde
   * la actividad la decide el rol de quien declara (`[]` si el rol no mapea).
   */
  declareOnActivityNumbers?: readonly number[]
  /** `slotPdtpDeclaration` de la fila nueva. */
  next: SlotPdtpDeclaration | null
  /** `slotPdtpDeclaration` de la fila anterior al cambio. */
  previous: SlotPdtpDeclaration | null
  /** Quien cambió la casilla: autor del desvío y del retiro. */
  userId: string
}

/**
 * Refleja en el PDTP el estado nuevo de una casilla. Nunca lanza.
 *
 * `tx` es la transacción de la casilla, para que el desvío quede en la misma
 * unidad de trabajo que el cambio que lo origina. Capacitación la llama además
 * en una transacción propia después del commit en un único caso —salir de
 * «hecha»—, porque ahí la ejecución acreditada recién se revoca después del
 * commit y un «no aplica» sobre una celda con ejecución viva el PDTP lo
 * rechaza.
 */
export async function propagateSlotStatusToPdtp(tx: Tx, input: SlotPdtpPropagationInput): Promise<void> {
  if (!input.next && !input.previous) return
  const { year, month, week } = input.cell
  const logContext = {
    module: input.source.module, slotId: input.source.slotId, worksiteId: input.worksiteId, year, month, week,
  }
  if (month === null || week === null) {
    logger.info(logContext, "[slot-pdtp-connector] La casilla no tiene mes/semana: no hay celda del PDTP que ajustar.")
    return
  }

  let activities: Array<{ id: string; n: number }>
  try {
    const resolved = await tx.transaction((sp) => resolveCellActivities(sp, input, { year, month, week }))
    if (!resolved) return
    activities = resolved
  } catch (err) {
    if (err instanceof PdtpNoActiveProgramError) {
      logger.warn({ ...logContext, err }, "[slot-pdtp-connector] Sin programa PDTP activo: la casilla cambia y el PDTP no se ajusta.")
    } else {
      logger.error({ ...logContext, err }, "[slot-pdtp-connector] No se pudo resolver la actividad PDTP de la casilla.")
    }
    return
  }

  const declareOn = input.declareOnActivityNumbers ? new Set(input.declareOnActivityNumbers) : null
  if (input.next && declareOn && !activities.some((activity) => declareOn.has(activity.n))) {
    logger.warn(
      { ...logContext, declareOnActivityNumbers: input.declareOnActivityNumbers },
      "[slot-pdtp-connector] Ninguna actividad PDTP corresponde a quien declaró la casilla: no se escribe desvío.",
    )
  }

  for (const activity of activities) {
    const next = !declareOn || declareOn.has(activity.n) ? input.next : null
    await syncActivityCell(tx, input, { activity, year, month, week, next }, logContext)
  }
}

async function resolveCellActivities(
  client: Tx,
  input: SlotPdtpPropagationInput,
  cell: { year: number; month: number; week: number },
): Promise<Array<{ id: string; n: number }> | null> {
  const numbers = "activityNumbers" in input.activities ? [...input.activities.activityNumbers] : []
  const resolved = await resolvePdtpActivityIdsForNumbers({
    worksiteId: input.worksiteId,
    // El programa vigente HOY, no el de la fecha de la celda: es el mismo que
    // opera la planilla del PDTP, y `recordPdtpDeviation` rechaza de todos
    // modos una celda anterior a su activación.
    occurredAt: new Date().toISOString(),
    plannedPeriod: cell,
    activityNumbers: numbers,
    sourceType: `casilla:${input.source.module}`,
    sourceId: input.source.slotId,
  }, client)
  // Fuera del año del programa: `resolvePdtpActiveProgramForEvent` ya lo dejó en el log.
  if (!resolved) return null

  if ("activityNumbers" in input.activities) {
    if (resolved.skippedNotFound.length > 0) {
      logger.warn(
        { module: input.source.module, slotId: input.source.slotId, programId: resolved.programId, skippedNotFound: resolved.skippedNotFound },
        "[slot-pdtp-connector] Actividades de la casilla que el programa no tiene; se omiten.",
      )
    }
    return numbers.flatMap((n) => {
      const id = resolved.activityIdByN.get(n)
      return id ? [{ id, n }] : []
    })
  }
  // Identidad de catálogo (vínculos de acreditación de capacitación): se busca
  // en el mismo programa que ya resolvió faena, año y versión.
  return client.select({ id: pdtpActivities.id, n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(and(
      eq(pdtpActivities.programId, resolved.programId),
      inArray(pdtpActivities.catalogActivityId, [...input.activities.catalogActivityIds]),
    ))
}

async function syncActivityCell(
  tx: Tx,
  input: SlotPdtpPropagationInput,
  target: { activity: { id: string; n: number }; year: number; month: number; week: number; next: SlotPdtpDeclaration | null },
  logContext: Record<string, unknown>,
): Promise<void> {
  const { activity, year, month, week, next } = target
  const context = { ...logContext, activityId: activity.id, activityN: activity.n }

  const [active] = await tx.select({
    id: pdtpExecutionDeviations.id,
    kind: pdtpExecutionDeviations.kind,
    reason: pdtpExecutionDeviations.reason,
  })
    .from(pdtpExecutionDeviations)
    .where(and(
      eq(pdtpExecutionDeviations.activityId, activity.id),
      eq(pdtpExecutionDeviations.worksiteId, input.worksiteId),
      eq(pdtpExecutionDeviations.year, year),
      eq(pdtpExecutionDeviations.month, month),
      eq(pdtpExecutionDeviations.week, week),
      eq(pdtpExecutionDeviations.status, "active"),
    ))
    .limit(1)

  if (active) {
    // Ya dice lo mismo (lo escribió la casilla o alguien desde la planilla):
    // el efecto sobre el cálculo es idéntico y no hay nada que corregir.
    if (next && active.kind === next.kind) return

    const { previous } = input
    if (!previous || active.kind !== previous.kind || active.reason !== previous.reason) {
      logger.warn(
        { ...context, deviationId: active.id, deviationKind: active.kind },
        "[slot-pdtp-connector] La celda ya tiene un desvío que no declaró esta casilla; no se reemplaza.",
      )
      return
    }

    // Savepoint propio y previo al registro: si el desvío nuevo no se puede
    // escribir (p. ej. «no hecha» a futuro), el viejo igual deja de afirmar
    // algo que la casilla ya no dice.
    const withdrawReason = next
      ? `Retirado automáticamente: la casilla ${input.source.label} se corrigió a «${SLOT_STATUS_LABELS[next.kind]}» en su submódulo.`
      : `Retirado automáticamente: la casilla ${input.source.label} dejó de declararse «${SLOT_STATUS_LABELS[previous.kind]}» en su submódulo.`
    try {
      await tx.transaction((sp) => withdrawPdtpDeviation({ deviationId: active.id, reason: withdrawReason }, input.userId, "all", sp))
    } catch (err) {
      logger.warn({ ...context, err, deviationId: active.id }, "[slot-pdtp-connector] No se pudo retirar el desvío que había propagado la casilla.")
      return
    }
  }

  if (!next) return
  try {
    // Savepoint también alrededor de las lecturas previas de
    // `recordPdtpDeviation`, no sólo de su escritura: cualquier error de SQL
    // tiene que deshacer sólo el desvío, nunca abortar la casilla.
    await tx.transaction((sp) => recordPdtpDeviation({
      activityId: activity.id,
      worksiteId: input.worksiteId,
      year,
      month,
      week,
      kind: next.kind,
      reason: next.reason,
    }, input.userId, "all", sp))
  } catch (err) {
    logger.warn({ ...context, err, kind: next.kind }, "[slot-pdtp-connector] El PDTP rechazó el desvío de la casilla; la casilla cambia igual.")
  }
}
