"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { DocumentLinkEntityType } from "@/lib/services/prevention-documents-library"
import {
  createDocumentLink,
  removeDocumentLink,
  DOCUMENT_LINK_ENTITY_TYPES,
} from "@/lib/services/prevention-documents-library"
import { fail, REVALIDATE } from "./shared"

export async function createSstDocumentLinkAction(input: {
  documentId: string
  entityType: string
  entityId: string
  notes?: string
}) {
  const guard = await guardPermission("prevention:docs:link")
  if (guard.error) return guard.error
  if (!DOCUMENT_LINK_ENTITY_TYPES.includes(input.entityType as DocumentLinkEntityType)) {
    return { ok: false, message: "Tipo de vínculo no soportado." }
  }
  try {
    await createDocumentLink({
      documentId: input.documentId,
      entityType: input.entityType as DocumentLinkEntityType,
      entityId: input.entityId,
      notes: input.notes,
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Vínculo validado y registrado." }
  } catch (error) {
    return fail(error)
  }
}

export async function removeSstDocumentLinkAction(input: {
  documentId: string
  linkId: string
  reason: string
}) {
  const guard = await guardPermission("prevention:docs:link")
  if (guard.error) return guard.error
  try {
    await removeDocumentLink({
      linkId: input.linkId,
      reason: input.reason,
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Vínculo retirado con trazabilidad." }
  } catch (error) {
    return fail(error)
  }
}
