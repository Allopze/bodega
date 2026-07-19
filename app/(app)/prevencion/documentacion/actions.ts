"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import type { Session } from "next-auth"
import { requireAuth, can, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { logger } from "@/lib/logger"
import { getDocumentBundle } from "@/lib/services/prevention-documents-library"
import {
  createDocument,
  uploadDocumentVersion,
  archiveDocument,
  restoreDocument,
  createDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  archiveDocumentFolder,
  restoreDocumentFolder,
  moveDocumentToFolder,
  listDocumentCategories,
  submitDocumentVersionForReview,
  returnObservedDocumentVersionToDraft,
  markDocumentVersionReviewed,
  observeDocumentVersion,
  approveDocumentVersion,
  publishDocumentVersion,
  acknowledgeDocumentVersion,
  assignDocumentVersionRecipients,
  exemptDocumentDistributionTarget,
  listDocumentRecipientOptions,
  createDocumentLink,
  removeDocumentLink,
  DOCUMENT_LINK_ENTITY_TYPES,
  regularizeDocumentIntegrityFinding,
} from "@/lib/services/prevention-documents-library"
import type {
  DocumentIntegrityFindingCode,
  DocumentIntegrityResolutionAction,
  DocumentLinkEntityType,
} from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { inArray } from "drizzle-orm"
import {
  sstDocumentCreateSchema,
  sstDocumentArchiveSchema,
  sstDocumentFolderCreateSchema,
  sstDocumentFolderUpdateSchema,
  sstDocumentFolderMoveSchema,
  sstDocumentMoveSchema,
} from "@/lib/validation/prevention"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/prevencion/documentacion"

function fail<T extends object = Record<string, never>>(error: unknown): ActionState & { data?: T } {
  return unexpectedActionError(error, "prevencion/documentacion/actions")
}

async function clientCtx(session: Session) {
  const h = await headers()
  return {
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  }
}

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

  // Subida tipo Drive: el modal exige clasificación, pero no categoría. Si la
  // categoría no viene, cae en la primera activa por sortOrder.
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
  const parsed = sstDocumentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del documento.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

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
    // La creación y la escritura del archivo no pueden compartir una única
    // transacción. Si falla la primera versión, compensamos archivando el
    // borrador recién creado para que no quede visible sin contenido.
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
): Promise<ActionState> {
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
  return runDocumentWorkflowAction(
    input,
    guard,
    submitDocumentVersionForReview,
    "Versión enviada a revisión.",
  )
}

export async function returnObservedSstDocumentVersionToDraftAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:submit_review")
  return runDocumentWorkflowAction(
    input,
    guard,
    returnObservedDocumentVersionToDraft,
    "Versión devuelta a borrador.",
  )
}

export async function markSstDocumentVersionReviewedAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:review")
  return runDocumentWorkflowAction(
    input,
    guard,
    markDocumentVersionReviewed,
    "Revisión registrada.",
  )
}

export async function observeSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:review")
  return runDocumentWorkflowAction(
    input,
    guard,
    observeDocumentVersion,
    "Versión observada y devuelta para corrección.",
  )
}

export async function approveSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:approve")
  return runDocumentWorkflowAction(
    input,
    guard,
    approveDocumentVersion,
    "Versión aprobada; aún no está publicada.",
  )
}

export async function publishSstDocumentVersionAction(input: DocumentWorkflowActionInput) {
  const guard = await guardPermission("prevention:docs:publish")
  return runDocumentWorkflowAction(
    input,
    guard,
    publishDocumentVersion,
    "Versión publicada y versión anterior reemplazada.",
  )
}

export async function assignSstDocumentRecipientsAction(input: {
  documentId: string
  versionId: string
  userIds: string[]
  assignmentReason: string
  dueAt?: string | null
}): Promise<ActionState> {
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

export async function acknowledgeSstDocumentVersionAction(input: {
  documentId: string
  versionId: string
}): Promise<ActionState> {
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
}): Promise<ActionState> {
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

export async function createSstDocumentLinkAction(input: {
  documentId: string
  entityType: string
  entityId: string
  notes?: string
}): Promise<ActionState> {
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
}): Promise<ActionState> {
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

export async function regularizeSstDocumentIntegrityAction(input: {
  documentId: string
  findingCode: DocumentIntegrityFindingCode
  action: DocumentIntegrityResolutionAction
  versionId?: string | null
  selectedVersionId?: string | null
  reason: string
}): Promise<ActionState> {
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
    return fail(e)
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
    return fail(e)
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
    return fail(e)
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
    return fail(e)
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
    return fail(e)
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
    return fail(e)
  }
}

/* Helper para revalidar desde la página después de una Server Action. */
export async function revalidateBiblioteca(documentId?: string) {
  revalidatePath(REVALIDATE)
  if (documentId) revalidatePath(`${REVALIDATE}/${documentId}`)
}

export async function getDocumentDetailAction(documentId: string) {
  let session
  try { session = await requireAuth() }
  catch { return { error: "No autenticado" } }
  if (!can(session, "prevention:docs:view")) return { error: "Sin permisos" }

  const scope = resolveWorksiteScope(session)
  const bundle = await getDocumentBundle(documentId, scope, session.user.permissions)
  if (!bundle) return { error: "Documento no encontrado" }

  const userIds = Array.from(new Set([
    bundle.doc.uploadedBy,
    session.user.id,
    ...bundle.versions.map((v) => v.uploadedBy),
    ...bundle.versions.flatMap((v) => [v.reviewedBy, v.approvedBy]),
    ...bundle.distribution.flatMap((target) => [target.userId, target.assignedByUserId, target.exemptedByUserId]),
  ].filter(Boolean) as string[]))

  const worksiteIds = Array.from(new Set([
    bundle.doc.worksiteId ?? "",
  ].filter(Boolean) as string[]))

  const canDistribute = can(session, "prevention:docs:distribute")
  const [userRows, worksiteRows, recipientOptions] = await Promise.all([
    userIds.length
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    worksiteIds.length
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    canDistribute ? listDocumentRecipientOptions(scope) : Promise.resolve([]),
  ])

  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w]))

  return {
    bundle,
    userMap,
    worksiteMap,
    canManage: can(session, "prevention:docs:manage"),
    canArchive: can(session, "prevention:docs:archive"),
    canSubmitReview: can(session, "prevention:docs:submit_review"),
    canReview: can(session, "prevention:docs:review"),
    canApprove: can(session, "prevention:docs:approve"),
    canPublish: can(session, "prevention:docs:publish"),
    canDistribute,
    canAck: can(session, "prevention:docs:ack"),
    canLink: can(session, "prevention:docs:link"),
    recipientOptions,
    currentUserId: session.user.id,
    currentUserName: userMap[session.user.id]?.name ?? session.user.email ?? "Yo",
    error: undefined as string | undefined,
  }
}
