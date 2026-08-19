/**
 * lib/services/requests-draft.ts
 *
 * Creación de solicitudes de compra (EPP/otro).
 *
 * Ya no existe una ruta de edición: desde la simplificación del flujo
 * (2026-08-07) estas solicitudes nacen enviadas y se corrigen aprobando,
 * rechazando o cancelando, nunca reescribiendo los ítems. Con eso desapareció
 * el persist por diff que protegía `approval_decisions` de un borrador
 * reescrito (auditoría A-01 / A-08): sin edición no hay reescritura.
 */

import { db } from "@/db"
import { and, eq } from "drizzle-orm"
import { purchaseRequests } from "@/db/schema"
import type { RequestFormData } from "@/lib/validation/operations"
import {
  createRequest,
  RequestSubmissionKeyConflictError,
  resolveCatalogItemQuantitiesTx,
  type RequestSubmissionIdentity,
} from "./requests-draft-create"
import { reserveReplenishmentGapsTx } from "./epp-replenishment"
import {
  getEppStockWarnings,
  lockActiveEppStockWorksite,
  readEppStockAvailabilityForLockedWorksite,
  type EppStockWarningItem,
} from "./epp-stock-availability"
import {
  EppStockConfirmationError,
  hashRequestSubmissionPayload,
  issueEppStockConfirmation,
  sameEppStockConfirmationSnapshot,
  verifyEppStockConfirmation,
} from "./epp-stock-confirmation"

export { RequestSubmissionKeyConflictError }

export interface EppStockSubmission {
  submissionKey: string
  confirmationToken?: string
}

export type CreatedSubmittedRequest = { kind: "created"; requestId: string; code: string; replayed: boolean }

export type CreateSubmittedRequestResult =
  | CreatedSubmittedRequest
  | {
    kind: "epp-stock-warning"
    confirmationToken: string
    worksiteName: string
    items: EppStockWarningItem[]
  }

async function findSubmissionReplayTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  requesterId: string,
  submission: RequestSubmissionIdentity,
): Promise<{ requestId: string; code: string } | null> {
  const [existing] = await tx
    .select({
      requestId: purchaseRequests.id,
      code: purchaseRequests.code,
      submissionPayloadHash: purchaseRequests.submissionPayloadHash,
    })
    .from(purchaseRequests)
    .where(and(
      eq(purchaseRequests.requesterId, requesterId),
      eq(purchaseRequests.submissionKey, submission.submissionKey),
    ))
    .for("update")
    .limit(1)
  if (!existing) return null
  if (existing.submissionPayloadHash !== submission.submissionPayloadHash) {
    throw new RequestSubmissionKeyConflictError()
  }
  return { requestId: existing.requestId, code: existing.code }
}

/** Applies server-derived catalog quantities before stock is compared or signed. */
function withCatalogDrivenQuantities(
  data: RequestFormData,
  drivenQuantities: ReadonlyMap<number, number>,
): RequestFormData {
  if (drivenQuantities.size === 0) return data
  return {
    ...data,
    items: data.items.map((item, index) => {
      const quantity = drivenQuantities.get(index)
      return quantity === undefined ? item : { ...item, quantity }
    }),
  }
}

/**
 * Crea una solicitud EPP/otro ya enviada a aprobación, en una sola transacción.
 *
 * The legacy internal callers do not carry an interactive confirmation. They
 * still receive the historical created shape (or a blocking error if stock
 * needs a decision); the browser action passes a submission and receives the
 * warning union below.
 */
export function createSubmittedRequest(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
): Promise<CreatedSubmittedRequest>
export function createSubmittedRequest(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
  submission: EppStockSubmission,
): Promise<CreateSubmittedRequestResult>
export async function createSubmittedRequest(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
  submission?: EppStockSubmission,
): Promise<CreateSubmittedRequestResult> {
  return await db.transaction(async (tx) => {
    const submissionIdentity = submission ? {
      submissionKey: submission.submissionKey,
      submissionPayloadHash: hashRequestSubmissionPayload(data),
    } satisfies RequestSubmissionIdentity : undefined

    // A retry after a successful request must redirect to the original row even
    // if its old confirmation has expired or stock has since moved.
    if (submissionIdentity) {
      const replay = await findSubmissionReplayTx(tx, sessionUserId, submissionIdentity)
      if (replay) return { kind: "created", ...replay, replayed: true }
    }

    // Take the worksite barrier once, at the beginning of the transaction. It
    // conflicts with inventory movement's FOR SHARE before a movement can add a
    // formerly absent stock row. Products, attributes and stock then follow in
    // deterministic order without a lock upgrade.
    const worksite = await lockActiveEppStockWorksite(tx, data.worksiteId, "no key update")

    // The first query is a fast path. Repeat it after the worksite barrier: a
    // concurrent identical submission can have committed while this attempt
    // waited behind an inventory movement, and must replay rather than issue a
    // fresh stock warning.
    if (submissionIdentity) {
      const replay = await findSubmissionReplayTx(tx, sessionUserId, submissionIdentity)
      if (replay) return { kind: "created", ...replay, replayed: true }
    }

    const catalogDrivenQuantities = await resolveCatalogItemQuantitiesTx(tx, data.items)
    const canonicalData = withCatalogDrivenQuantities(data, catalogDrivenQuantities)
    const availability = await readEppStockAvailabilityForLockedWorksite(tx, {
      worksite,
      items: canonicalData.items,
    })
    const warnings = getEppStockWarnings(availability.snapshot)

    if (warnings.length > 0) {
      if (!submissionIdentity) {
        throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock. Actualiza el formulario e inténtalo nuevamente.")
      }

      let confirmationStillMatches = false
      if (submission?.confirmationToken) {
        const signedSnapshot = verifyEppStockConfirmation({
          token: submission.confirmationToken,
          actorUserId: sessionUserId,
          submissionKey: submissionIdentity.submissionKey,
          payloadHash: submissionIdentity.submissionPayloadHash,
        })
        confirmationStillMatches = sameEppStockConfirmationSnapshot(signedSnapshot, availability.snapshot)
      }
      if (!confirmationStillMatches) {
        return {
          kind: "epp-stock-warning",
          confirmationToken: issueEppStockConfirmation({
            actorUserId: sessionUserId,
            submissionKey: submissionIdentity.submissionKey,
            payloadHash: submissionIdentity.submissionPayloadHash,
            snapshot: availability.snapshot,
          }),
          worksiteName: availability.worksiteName,
          items: warnings,
        }
      }
    }
    const { requestId, code, itemIds, replayed } = await createRequest(
      tx,
      canonicalData,
      sessionUserId,
      sessionUserEmail,
      submissionIdentity,
      catalogDrivenQuantities,
    )
    if (replayed) return { kind: "created", requestId, code, replayed: true }

    const reservations = canonicalData.items.flatMap((item, i) => {
      const key = item.replenishmentGapKey?.trim()
      const requestItemId = itemIds[i]
      return key && requestItemId ? [{ gapKey: key, requestItemId }] : []
    })
    if (reservations.length > 0) await reserveReplenishmentGapsTx(tx, reservations, canonicalData.worksiteId)

    return { kind: "created", requestId, code, replayed: false }
  })
}
