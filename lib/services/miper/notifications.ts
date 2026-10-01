/**
 * Avisos del flujo MIPER y de su barrido diario (§9.1 del rediseño, F3).
 *
 * Este módulo **no notifica**: arma *thunks* (`() => Promise<void>`) que el
 * llamador entrega a `notifyAfterCommit`. La razón está en la lección más cara
 * de la F1: los destinatarios se resuelven con
 * `getUserIdsWithPermissionForWorksite`, que consulta la conexión global `db`.
 * Llamarla dentro del callback de una transacción ejecuta consultas por otra
 * conexión del pool —con PGlite, una sola conexión, la suite se cuelga— y deja
 * el aviso (y su correo) emitido antes del COMMIT: un ROLLBACK posterior no lo
 * deshace. Por eso los `planX` se invocan siempre **después** de que
 * `await db.transaction(...)` resolvió.
 *
 * Deduplicación. Cada aviso lleva `dedupeKey` y el índice único parcial
 * `notifications_user_dedupe_unique` (`db/schema/audit.ts`: `(user_id,
 * dedupe_key)` con `dedupe_key IS NOT NULL`) garantiza **una sola notificación
 * por persona** aunque el evento se repita:
 *
 * - `miper-row-intolerable:{entryId}`: una fila que vuelve a Intolerable no
 *   avisa dos veces. Se deduplica por fila, no por versión: la fila ya está
 *   clasificada así y quien tiene que actuar ya lo sabe.
 * - `miper-occurrence-vencida:{occurrenceId}` y
 *   `miper-occurrence-no-hecha:{occurrenceId}`: por ocurrencia, no por día —
 *   volver a correr el barrido (o correrlo dos veces al día) no duplica nada.
 * - `miper-review-pendiente|devuelta|firma-pendiente:{matrixId}:{roundId}`: por
 *   ronda, no por matriz. Una segunda vuelta del flujo (tras responder
 *   observaciones) es un paso nuevo y merece su propio aviso.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { notifications } from "@/db/schema"
import type { NotificationType } from "@/db/schema/audit"
import { notifyAfterCommit, notifyManyUser, type CreateNotificationInput } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"

/** Mismo `entityType` que el resto del dominio de riesgos legales. */
const MIPER_ENTITY = "risk_legal:risk:miper"

const EDIT = "prevention:risk:edit"
const REVIEW = "prevention:risk:review"
const APPROVE_LEGAL = "prevention:risk:approve_legal"

/**
 * Resuelve destinatarios por permiso y faena. Inyectable para que el barrido
 * diario cachee una consulta por (permiso, faena) en vez de una por ocurrencia.
 */
export type MiperRecipientResolver = (permission: string, worksiteId: string) => Promise<string[]>

/** Resolver con memoria de una corrida: pocas faenas, muchos registros. */
export function cachedMiperRecipients(): MiperRecipientResolver {
  const cache = new Map<string, Promise<string[]>>()
  return (permission, worksiteId) => {
    const key = `${permission}::${worksiteId}`
    const hit = cache.get(key)
    if (hit) return hit
    const pending = getUserIdsWithPermissionForWorksite(permission, worksiteId)
    cache.set(key, pending)
    return pending
  }
}

/** Llaves de deduplicación del flujo MIPER (§9.1). Estables y legibles. */
export const miperDedupeKey = {
  rowIntolerable: (entryId: string) => `miper-row-intolerable:${entryId}`,
  occurrenceOverdue: (occurrenceId: string) => `miper-occurrence-vencida:${occurrenceId}`,
  occurrenceNotDone: (occurrenceId: string) => `miper-occurrence-no-hecha:${occurrenceId}`,
  reviewPending: (matrixId: string, roundId: string) => `miper-review-pendiente:${matrixId}:${roundId}`,
  reviewReturned: (matrixId: string, roundId: string) => `miper-review-devuelta:${matrixId}:${roundId}`,
  signaturePending: (matrixId: string, roundId: string) => `miper-firma-pendiente:${matrixId}:${roundId}`,
}

/** `?fila={entryId}` abre la ficha de la fila en el espacio de trabajo. */
function matrixHref(matrixId: string, extra: string): string {
  return `/prevencion/miper/${matrixId}?${extra}`
}

function label(matrixTitle: string | null | undefined, fallback: string): string {
  const title = matrixTitle?.trim()
  return title ? `«${title}»` : fallback
}

function withoutActor(userIds: readonly (string | null | undefined)[], actorUserId: string | null | undefined): string[] {
  const unique = new Set(userIds.filter((userId): userId is string => Boolean(userId)))
  if (actorUserId) unique.delete(actorUserId)
  return [...unique]
}

/**
 * Notifica y devuelve a quiénes les nació una notificación **nueva**.
 *
 * `createNotifications` ya salta a quienes tienen la llave (índice único
 * parcial) pero no lo dice: el barrido necesita saberlo para que la segunda
 * corrida del día reporte cero avisos en vez de recontar los mismos.
 */
async function notifyNewRecipients(
  userIds: readonly string[],
  input: Omit<CreateNotificationInput, "userId"> & { dedupeKey: string },
): Promise<string[]> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  const existing = await db.selectDistinct({ userId: notifications.userId }).from(notifications)
    .where(and(eq(notifications.dedupeKey, input.dedupeKey), inArray(notifications.userId, ids)))
  const already = new Set(existing.map((row) => row.userId))
  const fresh = ids.filter((userId) => !already.has(userId))
  if (fresh.length === 0) return []
  await notifyManyUser(fresh, input)
  return fresh
}

/* ── Fila que pasa a Intolerable (§9.1) ──────────────────────────────────── */

export type MiperRowIntolerableArgs = {
  matrixId: string
  worksiteId: string
  entryId: string
  rowNumber: number
  matrixTitle?: string | null
  /** Quien guardó la fila: no se avisa a sí mismo. */
  actorUserId?: string | null
  recipients?: MiperRecipientResolver
}

/**
 * El prevencionista de la faena (`prevention:risk:edit`) y la Jefa
 * (`prevention:risk:review`), unidos y sin el autor.
 */
export function planMiperRowIntolerable(args: MiperRowIntolerableArgs): () => Promise<void> {
  return async () => {
    const resolve = args.recipients ?? getUserIdsWithPermissionForWorksite
    const [editors, reviewers] = await Promise.all([
      resolve(EDIT, args.worksiteId),
      resolve(REVIEW, args.worksiteId),
    ])
    const recipients = withoutActor([...editors, ...reviewers], args.actorUserId)
    await notifyManyUser(recipients, {
      type: "miper_row_intolerable" satisfies NotificationType,
      title: "Fila Intolerable en la MIPER",
      body: `La fila N°${args.rowNumber} de la MIPER ${label(args.matrixTitle, "de la faena")} quedó clasificada como Intolerable. Revisa la medida, su responsable y su plazo.`,
      entityType: MIPER_ENTITY,
      entityId: args.matrixId,
      entityHref: matrixHref(args.matrixId, `fila=${args.entryId}`),
      dedupeKey: miperDedupeKey.rowIntolerable(args.entryId),
    })
  }
}

/**
 * El enganche que hay que llamar **después del COMMIT** cuando una fila pasa a
 * Intolerable. Vive acá —y no en `entries.ts`— porque también lo llama el
 * camino que carga filas por importación (RE-04): la clasificación es una
 * columna generada y no hay evento de base que escuchar, así que los dos
 * caminos que la escriben tienen que entrar por esta misma puerta.
 */
export function notifyMiperRowIntolerable(args: MiperRowIntolerableArgs): void {
  notifyAfterCommit(planMiperRowIntolerable(args))
}

/* ── Pasos del flujo: enviado, devuelto, pendiente de firma (§9.1) ───────── */

export type MiperReviewStepArgs = {
  matrixId: string
  worksiteId: string
  reviewState: "in_review" | "pending_approval" | "observed"
  /** `true` cuando el paso es una devolución con observaciones. */
  returned: boolean
  actorUserId: string
  /** Ronda del envío: distingue un aviso por paso, no uno por matriz. */
  roundId: string
  matrixTitle?: string | null
  /** Quien elaboró la MIPER: destinatario de una devolución. */
  submitterUserId?: string | null
  recipients?: MiperRecipientResolver
}

/**
 * El siguiente responsable del paso: la Jefa en la revisión técnica, Legal y
 * RRHH en la aprobación, y quien editó cuando la MIPER vuelve con
 * observaciones.
 */
export function planMiperReviewStep(args: MiperReviewStepArgs): () => Promise<void> {
  return async () => {
    const resolve = args.recipients ?? getUserIdsWithPermissionForWorksite
    const name = label(args.matrixTitle, "La MIPER")

    if (args.returned) {
      await notifyManyUser(withoutActor([args.submitterUserId], args.actorUserId), {
        type: "miper_review_returned" satisfies NotificationType,
        title: "MIPER devuelta con observaciones",
        body: `${name} volvió con observaciones: respóndelas y reenvídala a revisión.`,
        entityType: MIPER_ENTITY,
        entityId: args.matrixId,
        entityHref: matrixHref(args.matrixId, "tab=revision"),
        dedupeKey: miperDedupeKey.reviewReturned(args.matrixId, args.roundId),
      })
      return
    }

    if (args.reviewState === "pending_approval") {
      const signaturePending = await resolve(APPROVE_LEGAL, args.worksiteId)
      await notifyManyUser(withoutActor(signaturePending, args.actorUserId), {
        type: "miper_signature_pending" satisfies NotificationType,
        title: "MIPER pendiente de firma de Legal y RRHH",
        body: `${name} pasó la revisión técnica y espera la firma de Legal y RRHH.`,
        entityType: MIPER_ENTITY,
        entityId: args.matrixId,
        entityHref: matrixHref(args.matrixId, "tab=revision"),
        dedupeKey: miperDedupeKey.signaturePending(args.matrixId, args.roundId),
      })
      return
    }

    const reviewers = await resolve(REVIEW, args.worksiteId)
    await notifyManyUser(withoutActor(reviewers, args.actorUserId), {
      type: "miper_review_pending" satisfies NotificationType,
      title: "MIPER enviada a revisión",
      body: `${name} quedó esperando tu revisión técnica.`,
      entityType: MIPER_ENTITY,
      entityId: args.matrixId,
      entityHref: matrixHref(args.matrixId, "tab=revision"),
      dedupeKey: miperDedupeKey.reviewPending(args.matrixId, args.roundId),
    })
  }
}

/** Envoltorio post-commit del paso de flujo (`workflow.ts`). */
export function notifyMiperReviewStep(args: MiperReviewStepArgs): void {
  notifyAfterCommit(planMiperReviewStep(args))
}

/* ── Barrido diario: ocurrencia vencida y «No se hizo» (§9.1) ────────────── */

export type MiperOccurrenceOverdueArgs = {
  occurrenceId: string
  /** La ocurrencia cuelga de una actividad de una matriz: el enlace la abre ahí. */
  matrixId: string
  worksiteId: string
  actionNumber: number
  actionDescription: string
  dueOn: string
  /** Responsable nominal de la actividad; puede no haber. */
  responsibleUserId?: string | null
  recipients?: MiperRecipientResolver
}

/** Responsable + prevencionista (`prevention:risk:edit`), deduplicado por ocurrencia. */
export function planMiperOccurrenceOverdue(args: MiperOccurrenceOverdueArgs): () => Promise<string[]> {
  return async () => {
    const resolve = args.recipients ?? getUserIdsWithPermissionForWorksite
    const prevencionistas = await resolve(EDIT, args.worksiteId)
    const recipients = withoutActor([args.responsibleUserId, ...prevencionistas], null)
    return notifyNewRecipients(recipients, {
      type: "miper_occurrence_overdue" satisfies NotificationType,
      title: "Actividad del Programa de Trabajo vencida",
      body: `La actividad N°${args.actionNumber} «${args.actionDescription}» venció el ${args.dueOn} y sigue pendiente.`,
      entityType: MIPER_ENTITY,
      entityId: args.occurrenceId,
      entityHref: matrixHref(args.matrixId, `tab=programa&ocurrencia=${args.occurrenceId}`),
      dedupeKey: miperDedupeKey.occurrenceOverdue(args.occurrenceId),
    })
  }
}

export type MiperOccurrenceNotDoneArgs = {
  occurrenceId: string
  /** La ocurrencia cuelga de una actividad de una matriz: el enlace la abre ahí. */
  matrixId: string
  worksiteId: string
  actionNumber: number
  actionDescription: string
  dueOn: string
  recipients?: MiperRecipientResolver
}

/** «No se hizo» es una decisión de la faena: la Jefa es quien la revisa. */
export function planMiperOccurrenceNotDone(args: MiperOccurrenceNotDoneArgs): () => Promise<string[]> {
  return async () => {
    const resolve = args.recipients ?? getUserIdsWithPermissionForWorksite
    return notifyNewRecipients(await resolve(REVIEW, args.worksiteId), {
      type: "miper_occurrence_not_done" satisfies NotificationType,
      title: "Actividad del Programa registrada como «No se hizo»",
      body: `La actividad N°${args.actionNumber} «${args.actionDescription}» (plazo ${args.dueOn}) se registró como «No se hizo». Revisa el motivo y qué medida la cubre.`,
      entityType: MIPER_ENTITY,
      entityId: args.occurrenceId,
      entityHref: matrixHref(args.matrixId, `tab=programa&ocurrencia=${args.occurrenceId}`),
      dedupeKey: miperDedupeKey.occurrenceNotDone(args.occurrenceId),
    })
  }
}
