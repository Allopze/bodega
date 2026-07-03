"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { Session } from "next-auth"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createDocument,
  updateDocumentMetadata,
  uploadDocumentVersion,
  changeDocumentStatus,
  approveCurrentVersion,
  observeDocument,
  archiveDocument,
  restoreDocument,
  createDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  archiveDocumentFolder,
  restoreDocumentFolder,
  moveDocumentToFolder,
  linkDocumentToEntity,
  unlinkDocumentEntity,
  acknowledgeVersion,
  listDocumentCategories,
} from "@/lib/services/prevention-documents-library"
import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentStatusChangeSchema,
  sstDocumentObserveSchema,
  sstDocumentArchiveSchema,
  sstDocumentFolderCreateSchema,
  sstDocumentFolderUpdateSchema,
  sstDocumentFolderMoveSchema,
  sstDocumentMoveSchema,
  sstDocumentLinkSchema,
  sstDocumentUnlinkSchema,
  sstDocumentAckSchema,
} from "@/lib/validation/prevention"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/prevencion/documentacion"

async function clientCtx(session: Session) {
  const h = await headers()
  return {
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  }
}

export async function createSstDocumentAction(input: Parameters<typeof createDocument>[0]["data"]): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createDocument({
      data: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createAndUploadSstDocumentAction(formData: FormData): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const file = formData.get("file")
  if (!(file instanceof File)) return { ok: false, message: "Selecciona un archivo." }

  // Subida tipo Drive: el modal no pide categoría. Si no viene, cae en la
  // primera categoría activa (por sortOrder) como default; se re-clasifica luego.
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
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    expiresAt: String(formData.get("expiresAt") ?? ""),
    responsibleUserId: String(formData.get("responsibleUserId") ?? ""),
    requiresAcknowledgment: formData.get("requiresAcknowledgment") === "on",
    tags: [],
    extraMetadata: {},
  }
  const parsed = sstDocumentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del documento.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  try {
    const ctx = await clientCtx(session)
    const row = await createDocument({
      data: parsed.data,
      ctx,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
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
    return { ok: true, message: "Documento creado y archivo subido.", data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function updateSstDocumentAction(input: Parameters<typeof updateDocumentMetadata>[0]["input"]): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await updateDocumentMetadata({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
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
    return { ok: true, message: `Versión ${version.version} subida.`, data: { id: version.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function changeSstDocumentStatusAction(input: { documentId: string; toStatus: "borrador" | "en_revision" | "observado" | "aprobado" | "vigente" | "vencido" | "reemplazado" | "archivado"; comment?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:approve")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentStatusChangeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Datos inválidos.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await changeDocumentStatus({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.documentId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function approveSstDocumentAction(input: { documentId: string; comment?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await approveCurrentVersion({
      input: { documentId: input.documentId, comment: input.comment },
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Documento aprobado y vigente." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function observeSstDocumentAction(input: { documentId: string; comment: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:approve")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentObserveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "El comentario es obligatorio.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await observeDocument({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.documentId}`)
    return { ok: true, message: "Documento observado." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function archiveSstDocumentAction(input: { documentId: string; comment?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentArchiveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Datos inválidos." }
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
    return { ok: false, message: (e as Error).message }
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
    return { ok: false, message: (e as Error).message }
  }
}

export async function createSstDocumentFolderAction(input: { name: string; parentId?: string | null; worksiteId?: string | null }): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa el nombre de la carpeta.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const folder = await createDocumentFolder({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta creada.", data: { id: folder.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function renameSstDocumentFolderAction(input: { id: string; name: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa el nombre de la carpeta." }
  try {
    await renameDocumentFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta renombrada." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function moveSstDocumentFolderAction(input: { id: string; parentId?: string | null }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Destino inválido." }
  try {
    await moveDocumentFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta movida." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function archiveSstDocumentFolderAction(input: { id: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await archiveDocumentFolder({ input, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta archivada." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function restoreSstDocumentFolderAction(input: { id: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await restoreDocumentFolder({ input, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta restaurada." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function moveSstDocumentAction(input: { id: string; folderId?: string | null }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Destino inválido." }
  try {
    await moveDocumentToFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.id}`)
    return { ok: true, message: "Documento movido." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function linkSstDocumentAction(input: { documentId: string; entityType: "worker" | "worksite" | "vehicle"; entityId: string; notes?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:link")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentLinkSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Datos inválidos.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await linkDocumentToEntity({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(`${REVALIDATE}/${parsed.data.documentId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function unlinkSstDocumentAction(input: { linkId: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:link")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentUnlinkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Datos inválidos." }
  try {
    await unlinkDocumentEntity({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function acknowledgeSstDocumentAction(input: { versionId: string; signature: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:ack")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentAckSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Firma requerida.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await acknowledgeVersion({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    return { ok: true, message: "Acuse registrado." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/* Helper para revalidar desde la página después de una Server Action. */
export async function revalidateBiblioteca(documentId?: string) {
  revalidatePath(REVALIDATE)
  if (documentId) revalidatePath(`${REVALIDATE}/${documentId}`)
}

/* Helper para redirigir a la página de detalle tras crear un documento. */
export async function redirectToDocument(documentId: string) {
  redirect(`${REVALIDATE}/${documentId}`)
}
