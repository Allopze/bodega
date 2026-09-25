import { and, eq, inArray, isNull, not, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocumentDistributionTargets,
  sstDocumentLinks,
  sstDocumentAudit,
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { allowedDocumentConfidentialities, assertGeneralLibraryContentAllowed } from "./utils"
import { assertScopeAccess } from "./utils"
import { inspectDocumentLinkTargets } from "./links"
import { PreventionDocumentDomainError } from "./errors"

export type DocumentIntegrityFindingCode =
  | "DRAFT_WITH_PUBLISHED_VERSION"
  | "PUBLISHED_WITHOUT_APPROVER"
  | "CURRENT_VERSION_MISSING"
  | "CURRENT_VERSION_NOT_PUBLISHED"
  | "MULTIPLE_PUBLISHED_VERSIONS"
  | "REPLACED_WITHOUT_SUCCESSOR"
  | "ACK_WITHOUT_DISTRIBUTION"
  | "SENSITIVE_AUDIENCE_INCOMPATIBLE"
  | "PROHIBITED_SENSITIVE_CONTENT"
  | "SENSITIVE_GENERAL_LIBRARY_REVIEW"
  | "LINKED_ENTITY_MISSING"
  | "LINK_TARGET_UNVERIFIED"
  | "LINK_TARGET_SCOPE_MISMATCH"

export interface DocumentIntegrityFinding {
  code: DocumentIntegrityFindingCode
  severity: "critico" | "alto"
  documentId: string
  documentTitle: string
  versionId: string | null
  linkId: string | null
  detail: string
  recommendedAction: string
  evidenceUsable: false
}

export type DocumentIntegrityResolutionAction =
  | "restore_published_document"
  | "retire_unapproved_version"
  | "clear_invalid_current_version"
  | "choose_authoritative_version"
  | "link_successor"

export async function regularizeDocumentIntegrityFinding(args: {
  documentId: string
  findingCode: DocumentIntegrityFindingCode
  action: DocumentIntegrityResolutionAction
  versionId?: string | null
  selectedVersionId?: string | null
  reason: string
  userId: string
  scope: WorksiteScope
}) {
  const reason = args.reason.trim()
  if (reason.length < 5 || reason.length > 2000) {
    throw new PreventionDocumentDomainError("La regularización requiere un motivo de al menos 5 caracteres.")
  }

  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(sstDocuments)
      .where(eq(sstDocuments.id, args.documentId)).for("update").limit(1)
    if (!doc) throw new PreventionDocumentDomainError("Documento no encontrado.")
    assertScopeAccess(doc.worksiteId, args.scope)
    const now = new Date().toISOString()
    const before: Record<string, unknown> = {
      documentStatus: doc.status,
      currentVersionId: doc.currentVersionId,
      approvedBy: doc.approvedBy,
      approvedAt: doc.approvedAt,
    }
    let after: Record<string, unknown> = {}

    if (args.action === "restore_published_document") {
      if (args.findingCode !== "DRAFT_WITH_PUBLISHED_VERSION" || !args.versionId) throw new PreventionDocumentDomainError("Acción incompatible con el hallazgo.")
      const [version] = await tx.select().from(sstDocumentVersions)
        .where(and(eq(sstDocumentVersions.id, args.versionId), eq(sstDocumentVersions.documentId, doc.id))).for("update").limit(1)
      if (!version || version.status !== "vigente" || !hasDemonstrableApproval(version) || doc.status !== "borrador") {
        throw new PreventionDocumentDomainError("La versión no es una publicación aprobada apta para restaurar.")
      }
      await tx.update(sstDocuments).set({
        status: "vigente", currentVersionId: version.id,
        approvedBy: version.approvedBy, approvedAt: version.approvedAt, updatedAt: now,
      }).where(eq(sstDocuments.id, doc.id))
      after = { documentStatus: "vigente", currentVersionId: version.id, approvedBy: version.approvedBy, approvedAt: version.approvedAt }
    } else if (args.action === "retire_unapproved_version") {
      if (args.findingCode !== "PUBLISHED_WITHOUT_APPROVER" || !args.versionId) throw new PreventionDocumentDomainError("Acción incompatible con el hallazgo.")
      const [version] = await tx.select().from(sstDocumentVersions)
        .where(and(eq(sstDocumentVersions.id, args.versionId), eq(sstDocumentVersions.documentId, doc.id))).for("update").limit(1)
      if (!version || version.status !== "vigente" || hasDemonstrableApproval(version)) {
        throw new PreventionDocumentDomainError("La versión ya no corresponde a una publicación sin aprobación.")
      }
      await tx.update(sstDocumentVersions).set({ status: "archivado", updatedAt: now })
        .where(eq(sstDocumentVersions.id, version.id))
      if (doc.currentVersionId === version.id) {
        await tx.update(sstDocuments).set({
          status: "borrador", currentVersionId: null, approvedBy: null, approvedAt: null, updatedAt: now,
        }).where(eq(sstDocuments.id, doc.id))
      }
      after = { retiredVersionId: version.id, versionStatus: "archivado", currentVersionCleared: doc.currentVersionId === version.id }
    } else if (args.action === "clear_invalid_current_version") {
      if (!["CURRENT_VERSION_MISSING", "CURRENT_VERSION_NOT_PUBLISHED"].includes(args.findingCode) || !doc.currentVersionId) {
        throw new PreventionDocumentDomainError("Acción incompatible con el hallazgo.")
      }
      const [current] = await tx.select().from(sstDocumentVersions)
        .where(and(eq(sstDocumentVersions.id, doc.currentVersionId), eq(sstDocumentVersions.documentId, doc.id))).limit(1)
      if (current?.status === "vigente") throw new PreventionDocumentDomainError("La versión actual ya es vigente; recarga el inventario.")
      await tx.update(sstDocuments).set({
        status: "borrador", currentVersionId: null, approvedBy: null, approvedAt: null, updatedAt: now,
      }).where(eq(sstDocuments.id, doc.id))
      after = { documentStatus: "borrador", currentVersionId: null, clearedReference: doc.currentVersionId }
    } else if (args.action === "choose_authoritative_version") {
      if (args.findingCode !== "MULTIPLE_PUBLISHED_VERSIONS" || !args.selectedVersionId) throw new PreventionDocumentDomainError("Acción incompatible con el hallazgo.")
      const published = await tx.select().from(sstDocumentVersions)
        .where(and(eq(sstDocumentVersions.documentId, doc.id), eq(sstDocumentVersions.status, "vigente"))).for("update")
      const selected = published.find((version) => version.id === args.selectedVersionId)
      if (published.length < 2 || !selected || !hasDemonstrableApproval(selected)) {
        throw new PreventionDocumentDomainError("Selecciona una de las versiones vigentes que tenga aprobación demostrable.")
      }
      const retiredIds = published.filter((version) => version.id !== selected.id).map((version) => version.id)
      if (retiredIds.length) {
        await tx.update(sstDocumentVersions).set({ status: "archivado", updatedAt: now })
          .where(and(inArray(sstDocumentVersions.id, retiredIds), not(eq(sstDocumentVersions.id, selected.id))))
      }
      await tx.update(sstDocuments).set({
        status: "vigente", currentVersionId: selected.id,
        approvedBy: selected.approvedBy, approvedAt: selected.approvedAt, updatedAt: now,
      }).where(eq(sstDocuments.id, doc.id))
      after = { authoritativeVersionId: selected.id, retiredVersionIds: retiredIds }
    } else if (args.action === "link_successor") {
      if (args.findingCode !== "REPLACED_WITHOUT_SUCCESSOR" || !args.versionId || !args.selectedVersionId) {
        throw new PreventionDocumentDomainError("Acción incompatible con el hallazgo.")
      }
      const versions = await tx.select().from(sstDocumentVersions).where(and(
        eq(sstDocumentVersions.documentId, doc.id),
        inArray(sstDocumentVersions.id, [args.versionId, args.selectedVersionId]),
      )).for("update")
      const replaced = versions.find((version) => version.id === args.versionId)
      const successor = versions.find((version) => version.id === args.selectedVersionId)
      if (!replaced || replaced.status !== "reemplazado" || !successor || successor.version <= replaced.version) {
        throw new PreventionDocumentDomainError("La versión sucesora debe existir, ser posterior y pertenecer al mismo documento.")
      }
      if (successor.supersedesId && successor.supersedesId !== replaced.id) {
        throw new PreventionDocumentDomainError("La versión seleccionada ya declara otra predecesora.")
      }
      await tx.update(sstDocumentVersions).set({ supersedesId: replaced.id, updatedAt: now })
        .where(eq(sstDocumentVersions.id, successor.id))
      after = { replacedVersionId: replaced.id, successorVersionId: successor.id }
    } else {
      throw new Error("Acción de regularización no soportada.")
    }

    await tx.insert(sstDocumentAudit).values({
      id: `sda-${nanoid()}`,
      documentId: doc.id,
      versionId: args.versionId ?? args.selectedVersionId ?? null,
      action: "status_change",
      userId: args.userId,
      fromStatus: doc.status,
      toStatus: typeof after.documentStatus === "string" ? after.documentStatus : doc.status,
      comment: reason,
      metadata: {
        integrityResolution: true,
        findingCode: args.findingCode,
        resolutionAction: args.action,
        before,
        after,
      },
      createdAt: now,
    })
    return { before, after }
  })
}

export async function getDocumentIntegrityFindings(
  scope: WorksiteScope,
  permissions: readonly string[],
): Promise<DocumentIntegrityFinding[]> {
  if (scope.mode === "none") return []
  const conditions: SQL[] = [
    inArray(sstDocuments.confidentiality, allowedDocumentConfidentialities(permissions)),
  ]
  if (scope.mode === "some") {
    conditions.push(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))!)
  }
  const documents = await db.select().from(sstDocuments).where(and(...conditions)).limit(10_000)
  if (documents.length === 0) return []
  const documentIds = documents.map((doc) => doc.id)
  const versions = await db.select().from(sstDocumentVersions)
    .where(inArray(sstDocumentVersions.documentId, documentIds))
    .limit(50_000)
  const versionIds = versions.map((version) => version.id)
  const [distribution, links] = await Promise.all([
    versionIds.length
      ? db.select().from(sstDocumentDistributionTargets)
        .where(inArray(sstDocumentDistributionTargets.versionId, versionIds))
        .limit(100_000)
      : [],
    db.select().from(sstDocumentLinks)
      .where(and(inArray(sstDocumentLinks.documentId, documentIds), isNull(sstDocumentLinks.removedAt)))
      .limit(100_000),
  ])
  const linkInspections = await inspectDocumentLinkTargets(links)
  const inspectionByLinkId = new Map(linkInspections.map((inspection) => [inspection.linkId, inspection]))
  const linksByDocument = new Map<string, typeof links>()
  for (const link of links) {
    const rows = linksByDocument.get(link.documentId) ?? []
    rows.push(link)
    linksByDocument.set(link.documentId, rows)
  }

  const versionsByDocument = new Map<string, typeof versions>()
  for (const version of versions) {
    const rows = versionsByDocument.get(version.documentId) ?? []
    rows.push(version)
    versionsByDocument.set(version.documentId, rows)
  }
  const distributionByVersion = new Map<string, typeof distribution>()
  for (const target of distribution) {
    const rows = distributionByVersion.get(target.versionId) ?? []
    rows.push(target)
    distributionByVersion.set(target.versionId, rows)
  }

  const findings: DocumentIntegrityFinding[] = []
  for (const doc of documents) {
    const docVersions = versionsByDocument.get(doc.id) ?? []
    const current = docVersions.find((version) => version.id === doc.currentVersionId) ?? null
    const published = docVersions.filter((version) => version.status === "vigente")

    for (const link of linksByDocument.get(doc.id) ?? []) {
      const inspection = inspectionByLinkId.get(link.id)
      if (!inspection?.supported) {
        findings.push(finding(doc, "LINK_TARGET_UNVERIFIED", "critico", null,
          `El vínculo ${link.entityType}:${link.entityId} usa un tipo sin validador activo.`,
          "Retirar el vínculo o migrarlo a un tipo soportado cuya existencia y faena puedan comprobarse.", link.id))
      } else if (!inspection.exists) {
        findings.push(finding(doc, "LINKED_ENTITY_MISSING", "critico", null,
          `El vínculo ${link.entityType}:${link.entityId} apunta a una entidad inexistente.`,
          "Retirar el vínculo inválido con motivo auditado o enlazar la entidad correcta.", link.id))
      } else if (doc.worksiteId && inspection.worksiteId && doc.worksiteId !== inspection.worksiteId) {
        findings.push(finding(doc, "LINK_TARGET_SCOPE_MISMATCH", "critico", null,
          `El vínculo ${link.entityType}:${link.entityId} pertenece a otra faena.`,
          "Retirar el vínculo cruzado y crear uno que pertenezca a la misma faena del documento.", link.id))
      }
    }

    if (doc.confidentiality === "sensible" || doc.dataClass === "sensitive_preventive") {
      findings.push(finding(doc, "SENSITIVE_GENERAL_LIBRARY_REVIEW", "alto", doc.currentVersionId,
        "El documento general está clasificado como sensible y requiere confirmar finalidad, dueño, audiencia y repositorio correcto.",
        "Revisar accesos/descargas; reclasificar o reubicar mediante un procedimiento trazable sin borrado irreversible."))
    }
    const prohibitedVersion = docVersions.find((version) => {
      try {
        assertGeneralLibraryContentAllowed({
          dataClass: doc.dataClass,
          title: doc.title,
          fileName: version.fileName,
        })
        return false
      } catch {
        return true
      }
    })
    if (prohibitedVersion) {
      findings.push(finding(doc, "PROHIBITED_SENSITIVE_CONTENT", "critico", prohibitedVersion.id,
        "La clasificación o el nombre del expediente indica contenido clínico o de investigación reservada en la biblioteca general.",
        "Bloquear uso, revisar auditoría y reubicar al dominio seguro mediante cadena de custodia; no eliminar el original hasta autorizar retención."))
    }

    if (doc.status === "borrador" && published.length > 0) {
      findings.push(finding(doc, "DRAFT_WITH_PUBLISHED_VERSION", "critico", published[0]?.id ?? null,
        "El documento está en borrador, pero conserva una versión marcada vigente.",
        "Revisar el expediente y regularizar mediante una publicación o retiro auditado."))
    }
    for (const version of published) {
      if (!hasDemonstrableApproval(version)) {
        findings.push(finding(doc, "PUBLISHED_WITHOUT_APPROVER", "critico", version.id,
          `La versión v${version.version} figura vigente sin aprobador o fecha de aprobación.`,
          "Retirar de uso como evidencia y someter la versión a revisión/aprobación formal."))
      }
    }
    if (doc.currentVersionId && !current) {
      findings.push(finding(doc, "CURRENT_VERSION_MISSING", "critico", doc.currentVersionId,
        "currentVersionId apunta a una versión inexistente o ajena al documento.",
        "Reconstruir la referencia usando evidencia histórica y registrar antes/después."))
    } else if (current && current.status !== "vigente") {
      findings.push(finding(doc, "CURRENT_VERSION_NOT_PUBLISHED", "critico", current.id,
        `currentVersionId apunta a una versión en estado ${current.status}.`,
        "No usar como evidencia; publicar una versión aprobada o regularizar la referencia con auditoría."))
    }
    if (published.length > 1) {
      findings.push(finding(doc, "MULTIPLE_PUBLISHED_VERSIONS", "critico", null,
        `Existen ${published.length} versiones simultáneamente vigentes.`,
        "Determinar la versión válida y reemplazar las restantes mediante acciones auditadas."))
    }
    for (const replaced of docVersions.filter((version) => version.status === "reemplazado")) {
      const successor = docVersions.find((version) => version.supersedesId === replaced.id)
      if (!successor) {
        findings.push(finding(doc, "REPLACED_WITHOUT_SUCCESSOR", "alto", replaced.id,
          `La versión v${replaced.version} fue reemplazada sin una sucesora enlazada.`,
          "Identificar la versión sucesora y regularizar supersedesId con trazabilidad."))
      }
    }
    if (doc.requiresAcknowledgment && current?.status === "vigente") {
      const targets = distributionByVersion.get(current.id) ?? []
      if (targets.length === 0) {
        findings.push(finding(doc, "ACK_WITHOUT_DISTRIBUTION", "critico", current.id,
          "El documento exige acuse, pero la versión vigente no tiene destinatarios nominados.",
          "Definir y asignar el universo obligatorio antes de usar los acuses como evidencia."))
      }
      if (doc.confidentiality === "sensible" && targets.length > 1) {
        findings.push(finding(doc, "SENSITIVE_AUDIENCE_INCOMPATIBLE", "critico", current.id,
          `La versión sensible tiene ${targets.length} destinatarios y requiere revisión individual.`,
          "Retirar asignaciones incompatibles y redistribuir nominativamente con mínimo privilegio."))
      }
    }
  }
  return findings.sort((a, b) => a.documentTitle.localeCompare(b.documentTitle, "es"))
}

function finding(
  doc: { id: string; title: string },
  code: DocumentIntegrityFindingCode,
  severity: "critico" | "alto",
  versionId: string | null,
  detail: string,
  recommendedAction: string,
  linkId: string | null = null,
): DocumentIntegrityFinding {
  return {
    code,
    severity,
    documentId: doc.id,
    documentTitle: doc.title,
    versionId,
    linkId,
    detail,
    recommendedAction,
    evidenceUsable: false,
  }
}

/**
 * Una versión vigente tiene aprobación demostrable si pasó por el ciclo
 * (aprobador y fecha) o si su tipo no la exigía y quedó vigente al cargarla
 * (`approval_mode = 'not_required'`, una carta timbrada, un certificado). Sin
 * esa segunda rama, cada registro externo cargado aparecería como una
 * publicación crítica "sin aprobador".
 */
function hasDemonstrableApproval(version: { approvedBy: string | null; approvedAt: string | null; approvalMode: string }): boolean {
  return version.approvalMode === "not_required" || Boolean(version.approvedBy && version.approvedAt)
}
