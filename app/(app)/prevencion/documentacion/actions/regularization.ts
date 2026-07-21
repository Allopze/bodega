"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type {
  DocumentIntegrityFindingCode,
  DocumentIntegrityResolutionAction,
} from "@/lib/services/prevention-documents-library"
import { regularizeDocumentIntegrityFinding } from "@/lib/services/prevention-documents-library"
import { fail, REVALIDATE } from "./shared"

export async function regularizeSstDocumentIntegrityAction(input: {
  documentId: string
  findingCode: DocumentIntegrityFindingCode
  action: DocumentIntegrityResolutionAction
  versionId?: string | null
  selectedVersionId?: string | null
  reason: string
}) {
  const guard = await guardPermission("prevention:docs:publish")
  if (guard.error) return guard.error
  try {
    await regularizeDocumentIntegrityFinding({
      ...input,
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    revalidatePath(`${REVALIDATE}/regularizacion`)
    return { ok: true, message: "Regularización aplicada y auditada." }
  } catch (error) {
    return fail(error)
  }
}
