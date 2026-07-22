"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  submitDocumentVersionForReview,
  returnObservedDocumentVersionToDraft,
  markDocumentVersionReviewed,
  observeDocumentVersion,
  approveDocumentVersion,
  publishDocumentVersion,
} from "@/lib/services/prevention-documents-library"
import { clientCtx, fail, REVALIDATE } from "./shared"

type DocumentWorkflowActionInput = {
  documentId: string
  versionId: string
  comment?: string
}

type DocumentWorkflowOperation = (args: {
  versionId: string
  comment?: string
  ctx: Awaited<ReturnType<typeof clientCtx>>
  scope: ReturnType<typeof resolveWorksiteScope>
  permissions: readonly string[]
}) => Promise<unknown>

async function runDocumentWorkflowAction(
  input: DocumentWorkflowActionInput,
  guard: Awaited<ReturnType<typeof guardPermission>>,
  operation: DocumentWorkflowOperation,
  successMessage: string,
) {
  if (guard.error) return guard.error
  if (!input.documentId || !input.versionId) return { ok: false, message: "Documento y versión requeridos." }

  try {
    await operation({
      versionId: input.versionId,
      comment: input.comment,
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: successMessage }
  } catch (error) {
    return fail(error)
  }
}

export async function submitSstDocumentVersionForReviewAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:submit_review")
  return runDocumentWorkflowAction(input, guard, submitDocumentVersionForReview, "Versión enviada a revisión.")
}

export async function returnObservedSstDocumentVersionToDraftAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:submit_review")
  return runDocumentWorkflowAction(input, guard, returnObservedDocumentVersionToDraft, "Versión devuelta a borrador.")
}

export async function markSstDocumentVersionReviewedAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:review")
  return runDocumentWorkflowAction(input, guard, markDocumentVersionReviewed, "Revisión registrada.")
}

export async function observeSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:review")
  return runDocumentWorkflowAction(input, guard, observeDocumentVersion, "Versión observada y devuelta para corrección.")
}

export async function approveSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:approve")
  return runDocumentWorkflowAction(input, guard, approveDocumentVersion, "Versión aprobada; aún no está publicada.")
}

export async function publishSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:publish")
  return runDocumentWorkflowAction(input, guard, publishDocumentVersion, "Versión publicada y versión anterior reemplazada.")
}
