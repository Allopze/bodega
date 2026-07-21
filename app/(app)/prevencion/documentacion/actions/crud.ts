"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { parseZ } from "@/lib/actions/parse-z"
import {
  createDocument,
  uploadDocumentVersion,
  archiveDocument,
  restoreDocument,
  listDocumentCategories,
} from "@/lib/services/prevention-documents-library"
import {
  sstDocumentCreateSchema,
  sstDocumentArchiveSchema,
} from "@/lib/validation/prevention"
import type { ActionState } from "@/lib/validation/masters"
import { clientCtx, fail, REVALIDATE } from "./shared"

export async function createAndUploadSstDocumentAction(formData: FormData): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const file = formData.get("file")
  if (!(file instanceof File)) return { ok: false, message: "Selecciona un archivo." }
  const dataClass = formData.get("dataClass")
  if (typeof dataClass !== "string" || dataClass.length === 0) {
    return { ok: false, message: "Selecciona la clasificación del documento antes de cargarlo." }
  }

  let categorySlug = String(formData.get("categorySlug") ?? "")
  if (!categorySlug) {
    const categories = await listDocumentCategories(true)
    if (categories.length === 0) return { ok: false, message: "No hay categorías de documentos configuradas." }
    categorySlug = categories[0]!.slug
  }

  const input = {
    categorySlug,
    typeId: String(formData.get("typeId") ?? ""),
    folderId: String(formData.get("folderId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    internalCode: String(formData.get("internalCode") ?? ""),
    worksiteId: String(formData.get("worksiteId") ?? ""),
    confidentiality: String(formData.get("confidentiality") ?? "publico_interno"),
    dataClass,
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    expiresAt: String(formData.get("expiresAt") ?? ""),
    responsibleUserId: String(formData.get("responsibleUserId") ?? ""),
    requiresAcknowledgment: formData.get("requiresAcknowledgment") === "on",
    tags: [],
    extraMetadata: {},
  }
  const parsed = parseZ(sstDocumentCreateSchema, input)
  if (!parsed.ok) return parsed

  let documentId: string | null = null
  try {
    const ctx = await clientCtx(session)
    const row = await createDocument({
      data: parsed.data,
      ctx,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    documentId = row.id
    await uploadDocumentVersion({
      input: {
        documentId: row.id,
        file,
        changelog: "Primera versión cargada desde biblioteca",
      },
      ctx,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${row.id}`)
    return {
      ok: true,
      message: "Documento creado. La primera versión quedó como borrador pendiente de revisión.",
      data: { id: row.id },
    }
  } catch (e) {
    if (documentId) {
      try {
        await archiveDocument({
          input: { documentId, comment: "Archivado automáticamente: falló la carga de la primera versión." },
          ctx: await clientCtx(session),
          scope: resolveWorksiteScope(session),
        })
      } catch (archiveError) {
        logger.error("[prevencion/documentacion] falló la compensación de carga inicial", archiveError)
      }
    }
    return fail<{ id: string }>(e)
  }
}

export async function uploadSstDocumentVersionAction(formData: FormData): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return { ok: false, message: guard.error.message }
  const session = guard.session
  const file = formData.get("file")
  const documentId = String(formData.get("documentId") ?? "")
  if (!(file instanceof File) || !documentId) {
    return { ok: false, message: "Falta el archivo o el documento." }
  }
  try {
    const version = await uploadDocumentVersion({
      input: {
        documentId,
        file,
        changelog: formData.get("changelog") ? String(formData.get("changelog")) : undefined,
      },
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    revalidatePath(`${REVALIDATE}/${documentId}`)
    revalidatePath(REVALIDATE)
    return {
      ok: true,
      message: `Versión ${version.version} subida como borrador pendiente de revisión.`,
      data: { id: version.id },
    }
  } catch (e) {
    return fail<{ id: string }>(e)
  }
}

export async function archiveSstDocumentAction(input: { documentId: string; comment?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(sstDocumentArchiveSchema, input)
  if (!parsed.ok) return parsed
  try {
    await archiveDocument({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.documentId}`)
    return { ok: true, message: "Documento archivado." }
  } catch (e) {
    return fail<{ id: string }>(e)
  }
}

export async function restoreSstDocumentAction(input: { documentId: string; comment?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  if (!input.documentId) return { ok: false, message: "Documento requerido." }
  try {
    await restoreDocument({
      input,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Documento restaurado como borrador." }
  } catch (e) {
    return fail(e)
  }
}
