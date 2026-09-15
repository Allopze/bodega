import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import {
  sstDocumentAudit,
  sstDocuments,
  sstDocumentTypes,
  sstDocumentVersions,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { onDocumentVersionPublished } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import {
  assessRiohsCompleteness,
  RIOHS_DOCUMENT_TYPE_CODE,
  type RiohsMetadata,
} from "@/lib/prevention/riohs"
import {
  assertConfidentialityAllowed,
  assertScopeAccess,
  todayIso,
  type RequestContext,
  type SstDocumentConfidentiality,
} from "./utils"

type WorkflowStatus = "borrador" | "en_revision" | "observado" | "aprobado" | "vigente" | "reemplazado" | "archivado"

interface WorkflowInput {
  versionId: string
  comment?: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}

interface TransitionOptions {
  expected: WorkflowStatus
  next: WorkflowStatus
  auditAction: "status_change" | "observe" | "approve"
  requireComment?: boolean
  requireUploader?: boolean
  requireReviewed?: boolean
  preventUploader?: boolean
  preventReviewer?: boolean
  versionPatch?: (ctx: RequestContext) => Record<string, unknown>
}

async function lockWorkflowContext(tx: Tx, versionId: string) {
  const [versionRef] = await tx
    .select({ documentId: sstDocumentVersions.documentId })
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, versionId))

  if (!versionRef) throw new Error("Versión documental no encontrada.")

  const [doc] = await tx
    .select()
    .from(sstDocuments)
    .where(eq(sstDocuments.id, versionRef.documentId))
    .for("update")
  if (!doc) throw new Error("Documento no encontrado.")

  const [version] = await tx
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, versionId))
    .for("update")
  if (!version || version.documentId !== doc.id) {
    throw new Error("La versión no corresponde al documento.")
  }

  return { doc, version }
}

function authorizeWorkflowContext(args: WorkflowInput, doc: {
  worksiteId: string | null
  confidentiality: string
  status: string
}) {
  assertScopeAccess(doc.worksiteId, args.scope)
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)
  if (doc.status === "archivado") throw new Error("No se puede operar sobre un documento archivado.")
}

function auditValues(args: {
  documentId: string
  versionId: string
  ctx: RequestContext
  action: "status_change" | "observe" | "approve" | "replace"
  fromStatus: string
  toStatus: string
  comment?: string
  metadata?: Record<string, unknown>
  now: string
}) {
  return {
    id: `sda-${nanoid()}`,
    documentId: args.documentId,
    versionId: args.versionId,
    action: args.action,
    userId: args.ctx.userId,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    comment: args.comment?.trim() || null,
    metadata: args.metadata ?? null,
    ip: args.ctx.ip ?? null,
    createdAt: args.now,
  }
}

async function transitionVersion(args: WorkflowInput, options: TransitionOptions) {
  if (!args.versionId) throw new Error("Versión requerida.")
  const comment = args.comment?.trim() ?? ""
  if (comment.length > 2000) throw new Error("El comentario supera el máximo de 2.000 caracteres.")
  if (options.requireComment && comment.length < 3) {
    throw new Error("Debes registrar un comentario de al menos 3 caracteres.")
  }

  return db.transaction(async (tx) => {
    const { doc, version } = await lockWorkflowContext(tx, args.versionId)
    authorizeWorkflowContext(args, doc)

    if (version.status !== options.expected) {
      throw new Error(`La versión debe estar en estado ${options.expected} para realizar esta acción.`)
    }
    if (options.requireUploader && version.uploadedBy !== args.ctx.userId) {
      throw new Error("Sólo quien cargó la versión puede devolverla a borrador.")
    }
    if (options.preventUploader && version.uploadedBy === args.ctx.userId) {
      throw new Error("Quien cargó la versión no puede aprobarla.")
    }
    if (options.requireReviewed && !version.reviewedBy) {
      throw new Error("La versión debe tener una revisión registrada antes de aprobarse.")
    }
    if (options.preventReviewer && version.reviewedBy === args.ctx.userId) {
      throw new Error("Quien revisó la versión no puede aprobarla.")
    }

    const now = new Date().toISOString()
    const [updated] = await tx
      .update(sstDocumentVersions)
      .set({
        status: options.next,
        updatedAt: now,
        ...options.versionPatch?.(args.ctx),
      })
      .where(eq(sstDocumentVersions.id, version.id))
      .returning()
    if (!updated) throw new Error("No se pudo actualizar el estado de la versión.")

    if (!doc.currentVersionId) {
      const documentPatch: Record<string, unknown> = {
        status: options.next,
        updatedAt: now,
      }
      if (options.next === "en_revision") documentPatch.reviewedBy = updated.reviewedBy ?? null
      if (options.next === "aprobado") {
        documentPatch.reviewedBy = updated.reviewedBy
        documentPatch.approvedBy = updated.approvedBy
        documentPatch.approvedAt = updated.approvedAt
      }
      await tx.update(sstDocuments).set(documentPatch).where(eq(sstDocuments.id, doc.id))
    }

    await tx.insert(sstDocumentAudit).values(auditValues({
      documentId: doc.id,
      versionId: version.id,
      ctx: args.ctx,
      action: options.auditAction,
      fromStatus: options.expected,
      toStatus: options.next,
      comment,
      now,
    }))
    if (doc.worksiteId && doc.confidentiality === "publico_interno" && doc.dataClass === "operational") {
      await recordOperationalActivity({
        eventType: "document.workflow_updated",
        module: "documentacion",
        entityType: "sst_document",
        entityId: doc.id,
        entityCode: doc.internalCode,
        worksiteId: doc.worksiteId,
        actorUserId: args.ctx.userId,
        payload: { fromStatus: options.expected, toStatus: options.next },
      }, tx)
    }
    return updated
  })
}

export function submitDocumentVersionForReview(args: WorkflowInput) {
  return transitionVersion(args, {
    expected: "borrador",
    next: "en_revision",
    auditAction: "status_change",
    versionPatch: () => ({ reviewedBy: null, approvedBy: null, approvedAt: null }),
  })
}

export function returnObservedDocumentVersionToDraft(args: WorkflowInput) {
  return transitionVersion(args, {
    expected: "observado",
    next: "borrador",
    auditAction: "status_change",
    requireUploader: true,
    versionPatch: () => ({ approvedBy: null, approvedAt: null }),
  })
}

export function markDocumentVersionReviewed(args: WorkflowInput) {
  return transitionVersion(args, {
    expected: "en_revision",
    next: "en_revision",
    auditAction: "status_change",
    versionPatch: (ctx) => ({ reviewedBy: ctx.userId }),
  })
}

export function observeDocumentVersion(args: WorkflowInput) {
  return transitionVersion(args, {
    expected: "en_revision",
    next: "observado",
    auditAction: "observe",
    requireComment: true,
    versionPatch: (ctx) => ({ reviewedBy: ctx.userId, approvedBy: null, approvedAt: null }),
  })
}

export function approveDocumentVersion(args: WorkflowInput) {
  return transitionVersion(args, {
    expected: "en_revision",
    next: "aprobado",
    auditAction: "approve",
    requireReviewed: true,
    preventUploader: true,
    preventReviewer: true,
    versionPatch: (ctx) => ({ approvedBy: ctx.userId, approvedAt: new Date().toISOString() }),
  })
}

export async function publishDocumentVersion(args: WorkflowInput) {
  if (!args.versionId) throw new Error("Versión requerida.")

  let accreditation: Parameters<typeof onDocumentVersionPublished>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const { doc, version } = await lockWorkflowContext(tx, args.versionId)
    authorizeWorkflowContext(args, doc)
    if (version.status !== "aprobado") {
      throw new Error("Sólo se puede publicar una versión aprobada.")
    }
    if (!version.approvedBy || !version.approvedAt) {
      throw new Error("La aprobación de la versión está incompleta.")
    }
    /* Publicar no pasa por `transitionVersion`, así que su segregación va acá,
     * explícita. Hasta ahora no existía: la separación entre quien aprueba y
     * quien publica la daba sólo el reparto de permisos, y eso se cae en cuanto
     * un rol tiene `docs:manage` y `docs:publish` a la vez. Mismo vocabulario
     * que `preventUploader`/`preventReviewer` de arriba, un eslabón más abajo.
     * La jefatura técnica del área queda exenta. */
    // INC-002: la excepción por cargo deja constancia en la auditoría del
    // documento; antes se ejercía sin distinguirse de una firma con dos
    // personas distintas.
    const signing = resolveOwnWorkSigning({
      signedByUserId: version.approvedBy,
      actorUserId: args.ctx.userId,
      permissions: args.permissions,
      what: "Publicar la versión",
    })
    if (!signing.ok) {
      throw new Error("Quien aprobó la versión no puede publicarla: debe firmarla otra persona.")
    }
    if (version.effectiveFrom && version.effectiveFrom > todayIso()) {
      throw new Error(`La versión no puede publicarse antes del ${version.effectiveFrom}.`)
    }
    if (doc.currentVersionId === version.id) {
      throw new Error("La versión ya es la publicación vigente.")
    }
    await assertRiohsContentComplete(tx, doc)

    const now = new Date().toISOString()
    const previousVersionId = doc.currentVersionId
    if (previousVersionId) {
      const [previous] = await tx
        .select()
        .from(sstDocumentVersions)
        .where(eq(sstDocumentVersions.id, previousVersionId))
        .for("update")
      if (!previous || previous.documentId !== doc.id || previous.status !== "vigente") {
        throw new Error("La versión vigente anterior es inconsistente; requiere regularización administrativa.")
      }
      await tx
        .update(sstDocumentVersions)
        .set({ status: "reemplazado", effectiveTo: todayIso(), updatedAt: now })
        .where(eq(sstDocumentVersions.id, previous.id))
      await tx.insert(sstDocumentAudit).values(auditValues({
        documentId: doc.id,
        versionId: previous.id,
        ctx: args.ctx,
        action: "replace",
        fromStatus: "vigente",
        toStatus: "reemplazado",
        comment: args.comment,
        metadata: { replacedByVersionId: version.id },
        now,
      }))
    }

    const [published] = await tx
      .update(sstDocumentVersions)
      .set({
        status: "vigente",
        supersedesId: previousVersionId ?? version.supersedesId,
        updatedAt: now,
      })
      .where(eq(sstDocumentVersions.id, version.id))
      .returning()
    if (!published) throw new Error("No se pudo publicar la versión.")

    await tx
      .update(sstDocuments)
      .set({
        status: "vigente",
        currentVersionId: version.id,
        checksum: version.checksum,
        effectiveFrom: version.effectiveFrom ?? doc.effectiveFrom,
        reviewedBy: version.reviewedBy,
        approvedBy: version.approvedBy,
        approvedAt: version.approvedAt,
        updatedAt: now,
      })
      .where(eq(sstDocuments.id, doc.id))

    await tx.insert(sstDocumentAudit).values(auditValues({
      documentId: doc.id,
      versionId: version.id,
      ctx: args.ctx,
      action: "status_change",
      fromStatus: "aprobado",
      toStatus: "vigente",
      comment: args.comment,
      metadata: { previousVersionId, ownWorkExceptionUsed: signing.usedException },
      now,
    }))
    if (doc.worksiteId && doc.confidentiality === "publico_interno" && doc.dataClass === "operational") {
      await recordOperationalActivity({
        eventType: "document.workflow_updated",
        module: "documentacion",
        entityType: "sst_document",
        entityId: doc.id,
        entityCode: doc.internalCode,
        worksiteId: doc.worksiteId,
        actorUserId: args.ctx.userId,
        payload: { fromStatus: version.status, toStatus: "vigente" },
      }, tx)
    }

    // La actividad que acredita la declara el TIPO del documento, que es el
    // catálogo — igual que un curso frente a una sesión. Un documento
    // corporativo no tiene faena, y el programa se mide por faena, así que ahí
    // no hay nada que acreditar. Se dispara después del commit.
    if (doc.worksiteId && doc.typeId) {
      const [type] = await tx.select({ numbers: sstDocumentTypes.pdtpActivityNumbers })
        .from(sstDocumentTypes).where(eq(sstDocumentTypes.id, doc.typeId)).limit(1)
      const activityNumbers = Array.isArray(type?.numbers) ? type.numbers as number[] : []
      const accreditationTarget = await resolvePdtpAccreditationTarget({ sourceType: "documento", sourceId: doc.typeId, eventType: "publish", legacyActivityNumbers: activityNumbers }, tx)
      if (accreditationTarget.catalogActivityIds?.length || accreditationTarget.activityNumbers?.length) {
        accreditation = {
          documentId: doc.id,
          versionId: published.id,
          worksiteId: doc.worksiteId,
          publishedAt: now,
          ...accreditationTarget,
        }
      }
    }
    return published
  })

  if (accreditation) await onDocumentVersionPublished(accreditation)
  return result
}


/**
 * Gate de publicación del Reglamento Interno.
 *
 * El DS 44 art. 58 fija un contenido mínimo cerrado: publicar un RIOHS al que
 * le falta un capítulo obligatorio es publicar un documento que no cumple.
 * Se valida acá, en la transacción de publicación, y no en la UI, porque es
 * donde el documento pasa a ser el vigente.
 *
 * Sólo aplica al tipo documental RIOHS; el resto de la biblioteca no se toca.
 */
async function assertRiohsContentComplete(
  tx: Parameters<typeof lockWorkflowContext>[0],
  doc: { typeId: string | null; extraMetadata: unknown },
) {
  if (!doc.typeId) return
  const [type] = await tx
    .select({ code: sstDocumentTypes.code })
    .from(sstDocumentTypes)
    .where(eq(sstDocumentTypes.id, doc.typeId))
  if (type?.code !== RIOHS_DOCUMENT_TYPE_CODE) return

  const metadata = (doc.extraMetadata ?? {}) as RiohsMetadata
  const completeness = assessRiohsCompleteness(metadata.riohsSections)
  if (!completeness.complete) {
    throw new Error(
      `El Reglamento Interno no declara el contenido mínimo del DS 44 art. 58. Falta: ${completeness.missing.map((section) => section.title).join("; ")}.`,
    )
  }
}
