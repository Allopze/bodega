/**
 * Traductor CAPA → vocabulario del PDTP (D11, 2026-08-12).
 *
 * La acción correctiva vive en `prevention_capa_actions`. El PDTP la muestra
 * con su propio vocabulario (`estado`, `plazo`, `prioridad`, `hallazgo`) porque
 * es el que usa la jefatura de prevención y el que aparece en el Anexo 8. Este
 * módulo es la única frontera entre los dos idiomas: fuera de aquí, el PDTP no
 * conoce columnas de CAPA ni CAPA conoce palabras del PDTP.
 *
 * Existe además porque `/prevencion/pdtp/acciones` la ven roles —`jefe_terreno`,
 * `admin_contrato`, `supervisor_terreno`— que tienen `prevention:pdtp:view` sin
 * `prevention:capa:view`. No basta con redirigirlos al módulo CAPA: no pueden
 * entrar.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionCapaEvidence,
  preventionCapaTransitions,
  pdtpExecutions,
} from "@/db/schema"
import { isActionVencida, PDTP_ESTADOS_CERRADOS } from "./checklist-domain"
import type { WorksiteScope } from "./helpers"

type CapaRow = typeof preventionCapaActions.$inferSelect

/**
 * CAPA tiene siete estados y el PDTP seis: `verified` y `closed` colapsan
 * ambos en `verificado` porque el plan del PDTP nunca distinguió "verificada"
 * de "cerrada" — las dos cuentan como cierre en `PDTP_ESTADOS_CERRADOS`.
 */
export const CAPA_A_PDTP_ESTADO: Record<string, string> = {
  pending: "pendiente",
  in_progress: "en_proceso",
  pending_verification: "completado",
  verified: "verificado",
  closed: "verificado",
  reopened: "reabierto",
  cancelled: "cancelado",
}

/** El PDTP tiene tres prioridades; CAPA cuatro. `critical` y `high` son "alta". */
export const CAPA_A_PDTP_PRIORIDAD: Record<string, string> = {
  critical: "alta",
  high: "alta",
  medium: "media",
  low: "baja",
}

export function capaEstado(status: string): string {
  return CAPA_A_PDTP_ESTADO[status] ?? status
}

export function capaPrioridad(priority: string): string {
  return CAPA_A_PDTP_PRIORIDAD[priority] ?? "media"
}

/** Sólo las acciones del PDTP; `sourceId` es el id de la ejecución que las parió. */
export const capaEsDelPdtp = eq(preventionCapaActions.sourceType, "pdtp")

/**
 * Una acción del plan, en el vocabulario que consumen el panel de la ejecución
 * y `/prevencion/pdtp/acciones`.
 *
 * `n` es la numeración por ejecución que mostraba el espejo. No se materializa
 * —al retirar `pdtp_action_plan` deja de tener dueño— sino que se deriva del
 * orden de creación dentro de la ejecución.
 */
export function capaToPdtpAction(capa: CapaRow, n: number) {
  const estado = capaEstado(capa.status)
  const procedencia = (capa.sourceRef ?? null) as { seccionId?: string; itemId?: string } | null
  return {
    id:                capa.id,
    n,
    executionId:       capa.sourceId,
    worksiteId:        capa.worksiteId,
    hallazgo:          capa.finding,
    accion:            capa.actionDescription,
    responsable:       capa.responsibleSnapshot ?? capa.responsibleRole ?? "",
    responsableRole:   capa.responsibleRole ?? "",
    responsableUserId: capa.responsibleUserId,
    plazo:             capa.targetDate,
    prioridad:         capaPrioridad(capa.priority),
    estado,
    vencida:           isActionVencida(estado, capa.targetDate),
    danoPotencial:     capa.danoPotencial,
    normativaLegal:    capa.normativaLegal,
    // `origen` no se persiste: una acción viene de un ítem del checklist si y
    // sólo si guardó de cuál (A12).
    origen:            procedencia?.seccionId ? "checklist_item" : "manual",
    seccionId:         procedencia?.seccionId ?? null,
    itemId:            procedencia?.itemId ?? null,
    createdAt:         capa.createdAt,
    updatedAt:         capa.updatedAt,
    closedAt:          capa.closedAt ?? capa.verifiedAt,
    verifiedByUserId:  capa.verifiedByUserId,
    verifiedAt:        capa.verifiedAt,
    rejectionReason:   capa.reopenedReason,
    /** Necesario para escribir: CAPA usa bloqueo optimista. */
    version:           capa.version,
    capaCode:          capa.code,
    capaStatus:        capa.status,
  }
}

export type PdtpActionView = ReturnType<typeof capaToPdtpAction>

/** Numera por orden de creación dentro de la ejecución, como hacía el espejo. */
function numerar(rows: CapaRow[]): PdtpActionView[] {
  const nPorEjecucion = new Map<string, number>()
  return rows.map((row) => {
    const n = (nPorEjecucion.get(row.sourceId) ?? 0) + 1
    nPorEjecucion.set(row.sourceId, n)
    return capaToPdtpAction(row, n)
  })
}

/** Acciones de una ejecución, numeradas y en orden. */
export async function listPdtpActionsByExecution(executionId: string): Promise<PdtpActionView[]> {
  const rows = await db.select().from(preventionCapaActions)
    .where(and(capaEsDelPdtp, eq(preventionCapaActions.sourceId, executionId)))
    .orderBy(asc(preventionCapaActions.createdAt))
  return numerar(rows)
}

/**
 * Acciones de un programa completo, para la vista transversal. El filtro por
 * programa cruza `sourceId` con la ejecución y su actividad; el alcance por
 * faena se resuelve contra `prevention_capa_actions.worksiteId`, que es columna
 * directa y no necesita el join.
 *
 * HALLAZGO SEC-002 (S3/P2) — `scope` era `opts?.scope`, opcional. Omitirlo no
 * fallaba ni avisaba: la condición simplemente no se agregaba y la consulta
 * devolvía TODAS las faenas. Hoy todos los llamadores lo pasaban, así que no
 * hubo fuga, pero una pantalla nueva que lo olvidara la abría en silencio.
 * Ahora es un parámetro posicional obligatorio —el compilador es el guardián,
 * no la disciplina— y una lista vacía significa "ninguna faena", no "todas",
 * igual que en `worksiteScopeSqlFor` y en `assertTiWorksiteAccess`.
 */
export async function listPdtpActionsByProgram(
  programId: string,
  scope: WorksiteScope,
  opts?: {
    worksiteId?: string
    estado?: string
    prioridad?: string
    soloVencidas?: boolean
  },
): Promise<Array<PdtpActionView & { activityId: string }>> {
  if (scope !== "all" && scope.length === 0) return []

  const rows = await db.select({
    capa: preventionCapaActions,
    activityId: pdtpExecutions.activityId,
  })
    .from(preventionCapaActions)
    .innerJoin(pdtpExecutions, eq(pdtpExecutions.id, preventionCapaActions.sourceId))
    .where(and(
      capaEsDelPdtp,
      opts?.worksiteId ? eq(preventionCapaActions.worksiteId, opts.worksiteId) : undefined,
      scope !== "all" ? inArray(preventionCapaActions.worksiteId, scope) : undefined,
      sql`EXISTS (
        SELECT 1 FROM pdtp_activities a
        WHERE a.id = ${pdtpExecutions.activityId}
        AND a.program_id = ${programId}
      )`,
    ))
    // La numeración es por ejecución, así que se calcula sobre el orden de
    // creación y recién después se ordena para la vista.
    .orderBy(asc(preventionCapaActions.createdAt))

  const activityById = new Map(rows.map((row) => [row.capa.id, row.activityId]))
  let result = numerar(rows.map((row) => row.capa))
    .map((action) => ({ ...action, activityId: activityById.get(action.id)! }))

  // Estado y prioridad se filtran en memoria, no en SQL: llegan en vocabulario
  // PDTP y varios estados de CAPA colapsan en uno solo del PDTP.
  if (opts?.estado) result = result.filter((row) => row.estado === opts.estado)
  if (opts?.prioridad) result = result.filter((row) => row.prioridad === opts.prioridad)
  if (opts?.soloVencidas) result = result.filter((row) => row.vencida)

  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/** Pendientes y vencidas por ejecución, en una sola consulta (badges de la hoja). */
export async function countPdtpActionsByExecution(
  executionIds: string[],
): Promise<Map<string, { pending: number; overdue: number }>> {
  const result = new Map<string, { pending: number; overdue: number }>()
  if (executionIds.length === 0) return result

  const rows = await db.select({
    executionId: preventionCapaActions.sourceId,
    status: preventionCapaActions.status,
    targetDate: preventionCapaActions.targetDate,
  }).from(preventionCapaActions)
    .where(and(capaEsDelPdtp, inArray(preventionCapaActions.sourceId, executionIds)))

  for (const row of rows) {
    const estado = capaEstado(row.status)
    const entry = result.get(row.executionId) ?? { pending: 0, overdue: 0 }
    if (!PDTP_ESTADOS_CERRADOS.has(estado)) entry.pending++
    if (isActionVencida(estado, row.targetDate)) entry.overdue++
    result.set(row.executionId, entry)
  }
  return result
}

/** % de cierre del plan de acción de una o varias ejecuciones. */
export async function getPdtpActionClosureRate(executionIds: string[]): Promise<number | null> {
  if (executionIds.length === 0) return null
  const rows = await db.select({ status: preventionCapaActions.status })
    .from(preventionCapaActions)
    .where(and(capaEsDelPdtp, inArray(preventionCapaActions.sourceId, executionIds)))
  if (rows.length === 0) return null
  const cerradas = rows.filter((row) => PDTP_ESTADOS_CERRADOS.has(capaEstado(row.status))).length
  return Math.round((cerradas / rows.length) * 10000) / 100
}

/** Acciones abiertas cuyo plazo ya pasó, opcionalmente acotadas a un programa. */
export async function listPdtpActionsVencidas(programId?: string): Promise<PdtpActionView[]> {
  const rows = await db.select({ capa: preventionCapaActions })
    .from(preventionCapaActions)
    .innerJoin(pdtpExecutions, eq(pdtpExecutions.id, preventionCapaActions.sourceId))
    .where(and(
      capaEsDelPdtp,
      programId
        ? sql`EXISTS (
            SELECT 1 FROM pdtp_activities a
            WHERE a.id = ${pdtpExecutions.activityId}
            AND a.program_id = ${programId}
          )`
        : undefined,
    ))
    .orderBy(asc(preventionCapaActions.createdAt))

  return numerar(rows.map((row) => row.capa)).filter((action) => action.vencida)
}

/** Resuelve la faena de una acción para verificar alcance. */
export async function getPdtpActionWorksiteId(actionId: string): Promise<string | null> {
  const [row] = await db.select({ worksiteId: preventionCapaActions.worksiteId })
    .from(preventionCapaActions)
    .where(and(capaEsDelPdtp, eq(preventionCapaActions.id, actionId)))
    .limit(1)
  return row?.worksiteId ?? null
}

/**
 * Bitácora de una acción, en la forma que renderiza `ActionFollowupTimeline`.
 *
 * `prevention_capa_transitions` ya es la línea de tiempo completa: cada
 * escritura —evidencia, seguimiento o cambio de estado— inserta una fila con su
 * `changeType`, sus estados y su motivo. La evidencia se resuelve siguiendo el
 * `evidenceId` que la propia transición dejó en su `changeSet`.
 */
export async function listPdtpActionFollowups(actionId: string) {
  const rows = await db.select({
    transition: preventionCapaTransitions,
    evidenceKind: preventionCapaEvidence.kind,
    evidenceReference: preventionCapaEvidence.reference,
  })
    .from(preventionCapaTransitions)
    .leftJoin(
      preventionCapaEvidence,
      eq(preventionCapaEvidence.id, sql`${preventionCapaTransitions.changeSet}->>'evidenceId'`),
    )
    .where(eq(preventionCapaTransitions.actionId, actionId))
    .orderBy(desc(preventionCapaTransitions.createdAt))

  return rows.map(({ transition, evidenceKind, evidenceReference }) => ({
    id:              transition.id,
    actionPlanItemId: actionId,
    fecha:           transition.createdAt.slice(0, 10),
    estadoAnterior:  transition.fromStatus ? capaEstado(transition.fromStatus) : null,
    estadoNuevo:     transition.toStatus ? capaEstado(transition.toStatus) : "pendiente",
    observacion:     transition.reason,
    evidenciaUrl:    evidenceKind && evidenceKind !== "photo" ? evidenceReference : null,
    evidenciaPhotos: evidenceKind === "photo" && evidenceReference ? [evidenceReference] : [],
    updatedByUserId: transition.actorUserId,
    createdAt:       transition.createdAt,
  }))
}
