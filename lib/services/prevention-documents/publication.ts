/**
 * El único camino por el que una versión documental pasa a vigente.
 *
 * Hasta ahora ese paso vivía entero dentro de `publishDocumentVersion`, porque
 * era la única forma de llegar: revisión → aprobación → publicación. Con los
 * tipos que no requieren aprobación (un registro externo —una carta timbrada
 * por la SEREMI, un certificado— no se "aprueba": se recibe) hay un segundo
 * camino, la carga directa, y los dos tienen que dejar el documento en el mismo
 * estado: la vigente anterior reemplazada, `currentVersionId` al día, el
 * vencimiento recalculado y los efectos sobre el programa preventivo
 * disparados igual. Por eso el paso se extrajo acá y lo llaman ambos.
 *
 * Las compuertas propias de cada camino (aprobación y segregación al
 * publicar; que el tipo no exija aprobación al cargar) siguen en su llamador.
 * Lo que es regla del documento vigente —el contenido mínimo del RIOHS— vive
 * acá, para que ningún camino pueda saltárselo.
 */
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { sstDocumentAudit, sstDocuments, sstDocumentTypes, sstDocumentVersions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { assessRiohsCompleteness, RIOHS_DOCUMENT_TYPE_CODE, type RiohsMetadata } from "@/lib/prevention/riohs"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { onDocumentVersionPublished } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { onLegalFolderDocumentChanged } from "@/lib/services/pdtp-adapters/legal-folder-connector"
import { onRiohsVersionPublished } from "@/lib/services/pdtp-adapters/riohs-rollout-connector"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { addMonths } from "@/lib/utils"
import { todayIso, type RequestContext } from "./utils"

type SstDocumentRow = typeof sstDocuments.$inferSelect
type SstDocumentVersionRow = typeof sstDocumentVersions.$inferSelect

export type DocumentApprovalMode = "workflow" | "not_required"

/** Lo que el paso post-commit necesita saber de la versión que quedó vigente. */
export type DocumentVersionCurrentEffects = {
  documentId: string
  documentTitle: string
  versionId: string
  versionNumber: number
  worksiteId: string | null
  typeId: string | null
  typeCode: string | null
  /** Versión vigente que esta reemplazó, si había una. */
  previousVersionId: string | null
  becameCurrentAt: string
  /** Plazo de entrega a la dotación que declara el tipo (RIOHS: 30 días). */
  distributionDueDays: number | null
  /** Quien dejó vigente la versión: autor de la asignación a la dotación (N°18). */
  actorUserId: string
  /** N°43 y afines: lo que el tipo declara que acredita publicar. */
  publishAccreditation: {
    activityNumbers?: number[]
    catalogActivityIds?: string[]
  } | null
}

/**
 * Vencimiento del documento con la versión nueva.
 *
 * Publicar no lo actualizaba: un RIOHS v2 (validez 12 meses) conservaba el
 * vencimiento de la v1 y aparecía vencido al año de la primera publicación.
 * Manda, en orden, la vigencia declarada en la versión y la validez del tipo
 * contada desde su inicio. Sin ninguna de las dos, una primera publicación
 * conserva el vencimiento que alguien haya cargado a mano, y un reemplazo lo
 * limpia: ese vencimiento era de la versión anterior.
 */
function resolveExpiresAt(args: {
  doc: SstDocumentRow
  version: SstDocumentVersionRow
  validityMonths: number | null
  replacesPrevious: boolean
}): string | null {
  if (args.version.effectiveTo) return args.version.effectiveTo
  if (args.validityMonths && args.validityMonths > 0) {
    return addMonths(args.version.effectiveFrom ?? todayIso(), args.validityMonths)
  }
  return args.replacesPrevious ? null : args.doc.expiresAt
}

/**
 * Gate de publicación del Reglamento Interno.
 *
 * El DS 44 art. 58 fija un contenido mínimo cerrado: publicar un RIOHS al que
 * le falta un capítulo obligatorio es publicar un documento que no cumple.
 * Se valida en la transacción que lo deja vigente, y no en la UI, porque es
 * donde el documento pasa a ser el vigente.
 */
function assertRiohsContentComplete(doc: SstDocumentRow, typeCode: string | null) {
  if (typeCode !== RIOHS_DOCUMENT_TYPE_CODE) return
  const metadata = (doc.extraMetadata ?? {}) as RiohsMetadata
  const completeness = assessRiohsCompleteness(metadata.riohsSections)
  if (!completeness.complete) {
    throw new Error(
      `El Reglamento Interno no declara el contenido mínimo del DS 44 art. 58. Falta: ${completeness.missing.map((section) => section.title).join("; ")}.`,
    )
  }
}

/**
 * Deja vigente `version` dentro de `tx`. El llamador ya bloqueó `doc` y
 * `version` (`FOR UPDATE`) y validó las compuertas de su camino.
 */
export async function makeDocumentVersionCurrent(tx: Tx, args: {
  doc: SstDocumentRow
  version: SstDocumentVersionRow
  ctx: RequestContext
  comment?: string
  /** Estado desde el que llega: `aprobado` al publicar, `borrador` al cargar directo. */
  fromStatus: "aprobado" | "borrador"
  approvalMode: DocumentApprovalMode
  auditMetadata?: Record<string, unknown>
  now: string
}): Promise<{ published: SstDocumentVersionRow; effects: DocumentVersionCurrentEffects }> {
  const { doc, version, now } = args
  const [type] = doc.typeId
    ? await tx.select({
        code: sstDocumentTypes.code,
        validityMonths: sstDocumentTypes.defaultValidityMonths,
        requiresAcknowledgment: sstDocumentTypes.requiresAcknowledgment,
        distributionDueDays: sstDocumentTypes.distributionDueDays,
        pdtpActivityNumbers: sstDocumentTypes.pdtpActivityNumbers,
      }).from(sstDocumentTypes).where(eq(sstDocumentTypes.id, doc.typeId)).limit(1)
    : []
  const typeCode = type?.code ?? null

  assertRiohsContentComplete(doc, typeCode)

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
    await tx.insert(sstDocumentAudit).values(auditRow({
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
      approvalMode: args.approvalMode,
      updatedAt: now,
    })
    .where(eq(sstDocumentVersions.id, version.id))
    .returning()
  if (!published) throw new Error("No se pudo dejar vigente la versión.")

  await tx
    .update(sstDocuments)
    .set({
      status: "vigente",
      currentVersionId: version.id,
      checksum: version.checksum,
      effectiveFrom: version.effectiveFrom ?? doc.effectiveFrom,
      expiresAt: resolveExpiresAt({
        doc,
        version,
        validityMonths: type?.validityMonths ?? null,
        replacesPrevious: previousVersionId !== null,
      }),
      reviewedBy: version.reviewedBy,
      approvedBy: version.approvedBy,
      approvedAt: version.approvedAt,
      // Un documento subido desde la biblioteca nacía sin exigir acuse aunque
      // su tipo lo exija, y entonces no se podía distribuir. Se hereda del
      // tipo al quedar vigente; nunca se apaga uno que ya lo exigía.
      requiresAcknowledgment: doc.requiresAcknowledgment || Boolean(type?.requiresAcknowledgment),
      updatedAt: now,
    })
    .where(eq(sstDocuments.id, doc.id))

  await tx.insert(sstDocumentAudit).values(auditRow({
    documentId: doc.id,
    versionId: version.id,
    ctx: args.ctx,
    action: "status_change",
    fromStatus: args.fromStatus,
    toStatus: "vigente",
    comment: args.comment,
    metadata: { previousVersionId, approvalMode: args.approvalMode, ...args.auditMetadata },
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
      payload: { fromStatus: args.fromStatus, toStatus: "vigente" },
    }, tx)
  }

  // La actividad que acredita publicar la declara el TIPO del documento, que
  // es el catálogo — igual que un curso frente a una sesión. Un documento
  // corporativo no tiene faena, y la N°43 se mide por faena, así que ahí no
  // hay nada que acreditar por esta vía.
  let publishAccreditation: DocumentVersionCurrentEffects["publishAccreditation"] = null
  if (doc.worksiteId && doc.typeId) {
    const legacy = Array.isArray(type?.pdtpActivityNumbers) ? type.pdtpActivityNumbers as number[] : []
    const target = await resolvePdtpAccreditationTarget({
      sourceType: "documento",
      sourceId: doc.typeId,
      eventType: "publish",
      legacyActivityNumbers: legacy,
    }, tx)
    if (target.catalogActivityIds?.length || target.activityNumbers?.length) publishAccreditation = target
  }

  return {
    published,
    effects: {
      documentId: doc.id,
      documentTitle: doc.title,
      versionId: version.id,
      versionNumber: version.version,
      worksiteId: doc.worksiteId,
      typeId: doc.typeId,
      typeCode,
      previousVersionId,
      becameCurrentAt: now,
      distributionDueDays: type?.distributionDueDays ?? null,
      actorUserId: args.ctx.userId,
      publishAccreditation,
    },
  }
}

/**
 * Efectos sobre el programa preventivo, después del commit. Nunca lanzan: la
 * versión ya quedó vigente y un fallo del programa no puede deshacerla; cada
 * conector deja su hecho en un libro durable y reintentable.
 */
export async function dispatchDocumentVersionCurrentEffects(effects: DocumentVersionCurrentEffects): Promise<void> {
  try {
    if (effects.publishAccreditation && effects.worksiteId) {
      await onDocumentVersionPublished({
        documentId: effects.documentId,
        versionId: effects.versionId,
        worksiteId: effects.worksiteId,
        publishedAt: effects.becameCurrentAt,
        ...effects.publishAccreditation,
      })
    }
  } catch (error) {
    logger.error("[documents] no se pudieron despachar los efectos PDTP de la versión vigente", {
      versionId: effects.versionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  // N°19: un documento de la carpeta de requisitos legales quedó vigente. El
  // conector decide si el tipo le importa a algún programa activo; si no, no
  // hace nada.
  // N°18: una versión vigente del RIOHS abre la entrega a toda la dotación de
  // cada faena. Va antes de reevaluar la carpeta, que no depende de ella.
  if (effects.typeCode === RIOHS_DOCUMENT_TYPE_CODE) {
    await onRiohsVersionPublished({
      documentId: effects.documentId,
      documentTitle: effects.documentTitle,
      versionId: effects.versionId,
      versionNumber: effects.versionNumber,
      worksiteId: effects.worksiteId,
      becameCurrentAt: effects.becameCurrentAt,
      distributionDueDays: effects.distributionDueDays,
      actorUserId: effects.actorUserId,
    })
  }
  if (effects.typeId) {
    await onLegalFolderDocumentChanged({ typeIds: [effects.typeId], worksiteIds: [effects.worksiteId] })
  }
}

function auditRow(args: {
  documentId: string
  versionId: string
  ctx: RequestContext
  action: "status_change" | "replace"
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
