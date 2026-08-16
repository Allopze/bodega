"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  assignDocumentVersionRecipients,
  assignDocumentVersionToWorkforce,
  acknowledgeDocumentVersion,
  exemptDocumentDistributionTarget,
} from "@/lib/services/prevention-documents-library"
import { clientCtx, fail, REVALIDATE } from "./shared"

export async function assignSstDocumentRecipientsAction(input: {
  documentId: string
  versionId: string
  userIds: string[]
  assignmentReason: string
  dueAt?: string | null
}) {
  const guard = await guardPermission("prevention:docs:distribute")
  if (guard.error) return guard.error
  try {
    const inserted = await assignDocumentVersionRecipients({
      versionId: input.versionId,
      userIds: input.userIds,
      assignmentReason: input.assignmentReason,
      dueAt: input.dueAt,
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: `${inserted.length} destinatario(s) asignado(s).` }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Asigna la versión vigente a toda la dotación de la faena.
 *
 * Existe por el RIOHS, que el DS 44 art. 56 obliga a entregar a todas las
 * personas trabajadoras: hacerlo con el selector nominativo, de a 200 y sacando
 * a mano a quien ya lo tiene, no es un flujo que alguien complete.
 */
export async function assignSstDocumentToWorkforceAction(input: {
  documentId: string
  versionId: string
  assignmentReason: string
  dueAt?: string | null
}) {
  const guard = await guardPermission("prevention:docs:distribute")
  if (guard.error) return guard.error
  try {
    const result = await assignDocumentVersionToWorkforce({
      versionId: input.versionId,
      assignmentReason: input.assignmentReason,
      dueAt: input.dueAt,
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return {
      ok: true,
      message: result.assigned === 0
        ? `Toda la dotación ya tenía el documento asignado (${result.alreadyAssigned}).`
        : `${result.assigned} destinatario(s) asignado(s); ${result.alreadyAssigned} ya lo tenían.`,
    }
  } catch (error) {
    return fail(error)
  }
}

export async function acknowledgeSstDocumentVersionAction(input: {
  documentId: string
  versionId: string
}) {
  const guard = await guardPermission("prevention:docs:ack")
  if (guard.error) return guard.error
  try {
    await acknowledgeDocumentVersion({
      versionId: input.versionId,
      method: "digital",
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Acuse registrado para esta versión y checksum." }
  } catch (error) {
    return fail(error)
  }
}

export async function exemptSstDocumentRecipientAction(input: {
  documentId: string
  targetId: string
  reason: string
}) {
  const guard = await guardPermission("prevention:docs:distribute")
  if (guard.error) return guard.error
  try {
    await exemptDocumentDistributionTarget({
      targetId: input.targetId,
      reason: input.reason,
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Exención registrada con motivo y actor." }
  } catch (error) {
    return fail(error)
  }
}
