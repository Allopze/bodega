import { createHash } from "node:crypto"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  ppaSubmissions,
  preventionHealthClinicalPayloads,
  preventionHealthRecords,
  preventionPrivacyDeliveries,
  preventionPrivacyRequestExecutions,
  preventionPrivacyRequestHistory,
  preventionPrivacyRequests,
  preventionReservedCaseMembers,
  preventionReservedCaseSubjects,
  preventionReservedCases,
  preventionSensitiveAccessAudit,
  preventionSubjectProcessingRestrictions,
  sstDocumentAudit,
  sstDocumentLinks,
  sstDocuments,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"
import {
  findContextualSubjectMarkers,
  findDirectSubjectMarkers,
} from "@/lib/services/prevention-privacy-redaction"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"

const executionSchema = z.object({
  requestId: z.string().min(1),
  domain: z.enum(["health_record", "reserved_case", "ppa", "document"]),
  entityId: z.string().min(1),
  operation: z.enum(["rectification", "deletion", "opposition", "restriction"]),
  reason: z.string().trim().min(5).max(2000),
  purposeScope: z.string().trim().min(5).max(500).optional(),
  changes: z.record(z.string(), z.unknown()).default({}),
})

type ExecutionInput = z.infer<typeof executionSchema>

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireManagePermission(permissions: readonly string[]) {
  if (!permissions.includes("prevention:privacy:manage_requests")) {
    throw new Error("Solicitud no encontrada o fuera de alcance.")
  }
}

function hashSnapshot(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function assertRightMatchesOperation(rightType: string, operation: ExecutionInput["operation"]) {
  const expected: Record<string, ExecutionInput["operation"] | undefined> = {
    rectification: "rectification",
    deletion: "deletion",
    opposition: "opposition",
    restriction: "restriction",
  }
  if (expected[rightType] !== operation) {
    throw new Error("La operación no corresponde al derecho solicitado.")
  }
}

function restrictionDomain(domain: ExecutionInput["domain"]) {
  if (domain === "health_record") return "health"
  if (domain === "reserved_case") return "reserved_case"
  if (domain === "ppa") return "ppa"
  return "documents"
}

async function insertProcessingRestriction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    requestId: string
    subjectWorkerId: string
    domain: ExecutionInput["domain"]
    entityId: string
    operation: "opposition" | "restriction"
    purposeScope: string | undefined
    reason: string
    actorUserId: string
    now: string
  },
) {
  const [row] = await tx.insert(preventionSubjectProcessingRestrictions).values({
    id: `psr-${nanoid()}`,
    subjectWorkerId: args.subjectWorkerId,
    requestId: args.requestId,
    domain: restrictionDomain(args.domain),
    entityId: args.entityId,
    restrictionType: args.operation,
    purposeScope: args.purposeScope ?? "Todo tratamiento no obligatorio asociado a la entidad",
    reason: args.reason,
    status: "active",
    appliedByUserId: args.actorUserId,
    appliedAt: args.now,
  }).onConflictDoNothing().returning()
  if (!row) throw new Error("Ya existe una restricción activa equivalente.")
  return row
}

export async function executePreventionPrivacyRight(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requireManagePermission(args.permissions)
  const input = executionSchema.parse(args.input)
  const [requestRow] = await db.select().from(preventionPrivacyRequests)
    .where(eq(preventionPrivacyRequests.id, input.requestId)).limit(1)
  if (!requestRow) throw new Error("Solicitud no encontrada o fuera de alcance.")
  const [subject] = await db.select().from(workers).where(eq(workers.id, requestRow.subjectWorkerId)).limit(1)
  if (!subject || !scopeAllows(args.scope, subject.worksiteId)) throw new Error("Solicitud no encontrada o fuera de alcance.")
  if (requestRow.status !== "en_proceso" || !requestRow.identityVerifiedAt) {
    throw new Error("La identidad debe estar validada y la solicitud en proceso.")
  }
  if (requestRow.legalHold) throw new Error("La ejecución está suspendida por retención legal.")
  assertRightMatchesOperation(requestRow.rightType, input.operation)
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    let before: unknown
    let after: unknown
    let details: Record<string, unknown>

    if (input.domain === "health_record") {
      const [record] = await tx.select().from(preventionHealthRecords).where(and(
        eq(preventionHealthRecords.id, input.entityId),
        eq(preventionHealthRecords.workerId, subject.id),
      )).for("update").limit(1)
      if (!record || !scopeAllows(args.scope, record.worksiteId)) throw new Error("Registro no encontrado o fuera de alcance.")
      const [clinical] = await tx.select().from(preventionHealthClinicalPayloads)
        .where(eq(preventionHealthClinicalPayloads.healthRecordId, record.id)).for("update").limit(1)
      before = { record, clinicalCiphertext: clinical?.encryptedPayload ?? null }
      if (input.operation === "rectification") {
        const parsed = z.object({
          fitnessStatus: z.enum(["pendiente", "apto", "apto_con_restricciones", "no_apto"]).optional(),
          restrictionsSummary: z.string().trim().max(1000).nullable().optional(),
          validFrom: z.string().nullable().optional(),
          validUntil: z.string().nullable().optional(),
          issuerName: z.string().trim().max(200).nullable().optional(),
          providerName: z.string().trim().max(200).nullable().optional(),
          clinicalPayload: z.record(z.string(), z.unknown()).optional(),
        }).parse(input.changes)
        if (Object.keys(parsed).length === 0) throw new Error("Indica al menos una rectificación.")
        if (parsed.clinicalPayload && !args.permissions.includes("prevention:health:upload_clinical")) {
          throw new Error("No tienes autorización clínica nominativa para rectificar el payload.")
        }
        const { clinicalPayload, ...projectionChanges } = parsed
        await tx.update(preventionHealthRecords).set({ ...projectionChanges, updatedAt: now })
          .where(eq(preventionHealthRecords.id, record.id))
        if (clinicalPayload) {
          const encrypted = encryptPreventionPayload(clinicalPayload, `health:${record.id}`)
          await tx.insert(preventionHealthClinicalPayloads).values({
            id: clinical?.id ?? `phc-${nanoid()}`,
            healthRecordId: record.id,
            ...encrypted,
            createdByUserId: clinical?.createdByUserId ?? args.ctx.userId,
            createdAt: clinical?.createdAt ?? now,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: preventionHealthClinicalPayloads.healthRecordId,
            set: { ...encrypted, updatedAt: now },
          })
        }
        after = { ...record, ...projectionChanges, clinicalCiphertext: clinicalPayload ? "replaced" : clinical?.encryptedPayload ?? null }
        details = { changedFields: Object.keys(parsed), preservation: "registro operacional conservado" }
      } else if (input.operation === "deletion") {
        await tx.delete(preventionHealthClinicalPayloads).where(eq(preventionHealthClinicalPayloads.healthRecordId, record.id))
        await tx.update(preventionHealthRecords).set({
          status: "archivado",
          restrictionsSummary: null,
          issuerName: null,
          providerName: null,
          updatedAt: now,
        }).where(eq(preventionHealthRecords.id, record.id))
        after = { id: record.id, workerId: record.workerId, worksiteId: record.worksiteId, status: "archivado", clinicalPayload: null }
        details = { purgedClinicalPayload: Boolean(clinical), minimizedProjection: true, retainedSafetySkeleton: true }
      } else {
        const restriction = await insertProcessingRestriction(tx, {
          requestId: requestRow.id, subjectWorkerId: subject.id, domain: input.domain,
          entityId: record.id, operation: input.operation, purposeScope: input.purposeScope,
          reason: input.reason, actorUserId: args.ctx.userId, now,
        })
        after = restriction
        details = { restrictionId: restriction.id, purposeScope: restriction.purposeScope }
      }
    } else if (input.domain === "reserved_case") {
      if (!args.permissions.includes("prevention:reserved_case:investigate")) throw new Error("Caso no encontrado o fuera de alcance.")
      const [subjectLink] = await tx.select().from(preventionReservedCaseSubjects).where(and(
        eq(preventionReservedCaseSubjects.caseId, input.entityId),
        eq(preventionReservedCaseSubjects.workerId, subject.id),
        isNull(preventionReservedCaseSubjects.removedAt),
      )).for("update").limit(1)
      const [reservedCase] = await tx.select().from(preventionReservedCases)
        .where(eq(preventionReservedCases.id, input.entityId)).for("update").limit(1)
      const [membership] = await tx.select().from(preventionReservedCaseMembers).where(and(
        eq(preventionReservedCaseMembers.caseId, input.entityId),
        eq(preventionReservedCaseMembers.userId, args.ctx.userId),
      )).limit(1)
      if (!subjectLink || !reservedCase || !membership || !scopeAllows(args.scope, reservedCase.worksiteId)) {
        throw new Error("Caso no encontrado o fuera de alcance.")
      }
      before = { caseCiphertext: reservedCase.encryptedPayload, subjectLink }
      if (input.operation === "rectification" || input.operation === "deletion") {
        const payloadKey = input.operation === "rectification" ? "reservedPayload" : "redactedPayload"
        const replacement = z.record(z.string(), z.unknown()).parse(input.changes[payloadKey])
        const serialized = JSON.stringify(replacement)
        if (Buffer.byteLength(serialized, "utf8") > 150_000) throw new Error("El contenido reservado supera el máximo permitido.")
        /*
         * PRI-002 (auditoría 2026-09-14): la comprobación comparaba el RUT, el
         * nombre y el apellido tal como estaban guardados, en minúsculas y de
         * forma literal. Bastaba escribir el RUT con puntos, el apellido sin
         * tilde, o dejar sólo una mitad de un apellido compuesto, para que la
         * supresión se diera por buena; y el id técnico del trabajador ni
         * siquiera se miraba. Ahora ambos lados se normalizan al mismo alfabeto
         * y el conjunto de identificadores directos cubre todo lo que la
         * plataforma guarda de la persona (ver prevention-privacy-redaction.ts).
         */
        let contextualMarkers: string[] = []
        if (input.operation === "deletion") {
          const directMarkers = findDirectSubjectMarkers(serialized, subject)
          if (directMarkers.length > 0) {
            throw new Error("El payload redactado aún contiene identificadores directos del titular.")
          }
          /*
           * Cuasi-identificadores (cargo, faena): NO bloquean —la plataforma no
           * declara hasta dónde llega la anonimización exigible y rechazar toda
           * mención de la faena haría irredactable un caso que trata de esa
           * faena—, pero quedan anotados en la ejecución para que la
           * reidentificación por contexto sea revisable. Decisión pendiente.
           */
          const [worksite] = await tx.select({ name: worksites.name }).from(worksites)
            .where(eq(worksites.id, reservedCase.worksiteId)).limit(1)
          contextualMarkers = findContextualSubjectMarkers(serialized, subject, {
            worksiteName: worksite?.name ?? null,
          })
        }
        const encrypted = encryptPreventionPayload(replacement, `reserved:${reservedCase.id}`)
        await tx.update(preventionReservedCases).set({ ...encrypted, updatedAt: now })
          .where(eq(preventionReservedCases.id, reservedCase.id))
        if (input.operation === "deletion") {
          await tx.update(preventionReservedCaseSubjects).set({
            removedByUserId: args.ctx.userId,
            removedAt: now,
            removalReason: input.reason,
          }).where(eq(preventionReservedCaseSubjects.id, subjectLink.id))
        }
        after = { caseCiphertext: encrypted.encryptedPayload, subjectLinkRemoved: input.operation === "deletion" }
        details = {
          payloadReencrypted: true,
          subjectLinkRemoved: input.operation === "deletion",
          contentStoredInAudit: false,
          // PRI-002: lista de cuasi-identificadores que sobrevivieron (nunca su
          // contenido, sólo la etiqueta) para que la revisión posterior sepa
          // dónde puede quedar reidentificación por contexto.
          quasiIdentifiersRetained: contextualMarkers,
        }
      } else {
        const restriction = await insertProcessingRestriction(tx, {
          requestId: requestRow.id, subjectWorkerId: subject.id, domain: input.domain,
          entityId: reservedCase.id, operation: input.operation, purposeScope: input.purposeScope,
          reason: input.reason, actorUserId: args.ctx.userId, now,
        })
        after = restriction
        details = { restrictionId: restriction.id, purposeScope: restriction.purposeScope }
      }
    } else if (input.domain === "ppa") {
      const [ppa] = await tx.select().from(ppaSubmissions).where(and(
        eq(ppaSubmissions.id, input.entityId),
        eq(ppaSubmissions.workerId, subject.id),
      )).for("update").limit(1)
      if (!ppa || !scopeAllows(args.scope, ppa.worksiteId)) throw new Error("PPA no encontrado o fuera de alcance.")
      const ppaIdentityBefore = { workerId: ppa.workerId, workerName: ppa.workerName, workerRut: ppa.workerRut, workerCompany: ppa.workerCompany }
      before = ppaIdentityBefore
      if (input.operation === "rectification") {
        const changes = z.object({
          workerName: z.string().trim().min(2).max(200).optional(),
          workerRut: z.string().trim().max(30).nullable().optional(),
          workerCompany: z.string().trim().max(200).nullable().optional(),
        }).parse(input.changes)
        if (Object.keys(changes).length === 0) throw new Error("Indica al menos una rectificación.")
        await tx.update(ppaSubmissions).set({ ...changes, updatedAt: now }).where(eq(ppaSubmissions.id, ppa.id))
        after = { ...ppaIdentityBefore, ...changes }
        details = { changedFields: Object.keys(changes), safetyAnswersPreserved: true }
      } else if (input.operation === "deletion") {
        await tx.update(ppaSubmissions).set({
          workerId: null,
          workerName: "Titular suprimido",
          workerRut: null,
          workerCompany: null,
          manualIdentificacion: true,
          updatedAt: now,
        }).where(eq(ppaSubmissions.id, ppa.id))
        after = { workerId: null, workerName: "Titular suprimido", workerRut: null, workerCompany: null }
        details = { directIdentifiersRemoved: true, safetyAnswersPreserved: true }
      } else {
        const restriction = await insertProcessingRestriction(tx, {
          requestId: requestRow.id, subjectWorkerId: subject.id, domain: input.domain,
          entityId: ppa.id, operation: input.operation, purposeScope: input.purposeScope,
          reason: input.reason, actorUserId: args.ctx.userId, now,
        })
        after = restriction
        details = { restrictionId: restriction.id, purposeScope: restriction.purposeScope }
      }
    } else {
      const [linkRow] = await tx.select({ link: sstDocumentLinks, document: sstDocuments })
        .from(sstDocumentLinks).innerJoin(sstDocuments, eq(sstDocumentLinks.documentId, sstDocuments.id))
        .where(and(
          eq(sstDocumentLinks.id, input.entityId),
          eq(sstDocumentLinks.entityType, "worker"),
          eq(sstDocumentLinks.entityId, subject.id),
          isNull(sstDocumentLinks.removedAt),
        )).for("update").limit(1)
      if (!linkRow || (linkRow.document.worksiteId && !scopeAllows(args.scope, linkRow.document.worksiteId))) {
        throw new Error("Documento no encontrado o fuera de alcance.")
      }
      before = linkRow.link
      if (input.operation === "deletion") {
        await tx.update(sstDocumentLinks).set({
          removedByUserId: args.ctx.userId,
          removedAt: now,
          removalReason: input.reason,
        }).where(eq(sstDocumentLinks.id, linkRow.link.id))
        await tx.insert(sstDocumentAudit).values({
          id: `sda-${nanoid()}`,
          documentId: linkRow.document.id,
          action: "unlink",
          userId: args.ctx.userId,
          comment: input.reason,
          metadata: { privacyRequestId: requestRow.id, linkId: linkRow.link.id, subjectWorkerId: subject.id },
          createdAt: now,
        })
        after = { ...linkRow.link, removedAt: now, removedByUserId: args.ctx.userId }
        details = { nominativeLinkRemoved: true, documentBinaryUnchanged: true }
      } else if (input.operation === "opposition" || input.operation === "restriction") {
        const restriction = await insertProcessingRestriction(tx, {
          requestId: requestRow.id, subjectWorkerId: subject.id, domain: input.domain,
          entityId: linkRow.link.id, operation: input.operation, purposeScope: input.purposeScope,
          reason: input.reason, actorUserId: args.ctx.userId, now,
        })
        after = restriction
        details = { restrictionId: restriction.id, purposeScope: restriction.purposeScope }
      } else {
        throw new Error("La rectificación del binario documental exige una nueva versión revisada y aprobada.")
      }
    }

    const [execution] = await tx.insert(preventionPrivacyRequestExecutions).values({
      id: `ppre-${nanoid()}`,
      requestId: requestRow.id,
      domain: input.domain,
      entityId: input.entityId,
      operation: input.operation,
      outcome: "applied",
      beforeHash: hashSnapshot(before),
      afterHash: hashSnapshot(after),
      reason: input.reason,
      details,
      actorUserId: args.ctx.userId,
      createdAt: now,
    }).returning()
    if (!execution) throw new Error("No se pudo registrar la ejecución del derecho.")
    await tx.insert(preventionSensitiveAccessAudit).values({
      id: `psa-${nanoid()}`,
      domain: "privacy_request",
      entityId: requestRow.id,
      subjectWorkerId: subject.id,
      worksiteId: subject.worksiteId,
      actorUserId: args.ctx.userId,
      action: "update",
      purpose: `ejecucion_${input.operation}_${input.domain}`,
      outcome: "granted",
      ip: args.ctx.ip ?? null,
      userAgent: args.ctx.userAgent ?? null,
      createdAt: now,
    })
    return execution
  })
}

/**
 * Atender una solicitud ARCO no da acceso a los dominios reservados del titular.
 * `prevention:privacy:manage_requests` está concedido a roles que NO tienen
 * `reserved_case:view/investigate` ni `health:view_restrictions`: sin este gate,
 * el inventario revelaba que una persona es parte de un expediente Ley Karin
 * (código, categoría y estado) y su aptitud ocupacional, que es justamente lo
 * que la reserva protege. El resto del módulo exige membresía nominativa en
 * cada lectura; aquí se aplica el mismo criterio.
 */
export async function getPreventionPrivacyRequestWorkbench(args: {
  requestId: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requireManagePermission(args.permissions)
  const canSeeReserved = args.permissions.includes("prevention:reserved_case:view")
    || args.permissions.includes("prevention:reserved_case:investigate")
  const canSeeFitness = args.permissions.includes("prevention:health:view_restrictions")
  const [requestRow] = await db.select().from(preventionPrivacyRequests)
    .where(eq(preventionPrivacyRequests.id, args.requestId)).limit(1)
  if (!requestRow) return null
  const [subject] = await db.select().from(workers).where(eq(workers.id, requestRow.subjectWorkerId)).limit(1)
  if (!subject || !scopeAllows(args.scope, subject.worksiteId)) return null

  const [worksite, healthRecords, reservedCases, ppas, documentLinks, executions, restrictions, history, deliveries] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.id, subject.worksiteId)).limit(1),
    db.select({
      id: preventionHealthRecords.id,
      recordType: preventionHealthRecords.recordType,
      status: preventionHealthRecords.status,
      fitnessStatus: preventionHealthRecords.fitnessStatus,
      validUntil: preventionHealthRecords.validUntil,
    }).from(preventionHealthRecords).where(eq(preventionHealthRecords.workerId, subject.id)).orderBy(desc(preventionHealthRecords.createdAt)),
    db.select({
      subjectLinkId: preventionReservedCaseSubjects.id,
      id: preventionReservedCases.id,
      code: preventionReservedCases.code,
      category: preventionReservedCases.category,
      status: preventionReservedCases.status,
      worksiteId: preventionReservedCases.worksiteId,
      memberUserId: preventionReservedCaseMembers.userId,
    }).from(preventionReservedCaseSubjects)
      .innerJoin(preventionReservedCases, eq(preventionReservedCaseSubjects.caseId, preventionReservedCases.id))
      .leftJoin(preventionReservedCaseMembers, and(
        eq(preventionReservedCaseMembers.caseId, preventionReservedCases.id),
        eq(preventionReservedCaseMembers.userId, args.ctx.userId),
      ))
      .where(and(eq(preventionReservedCaseSubjects.workerId, subject.id), isNull(preventionReservedCaseSubjects.removedAt))),
    db.select({ id: ppaSubmissions.id, estado: ppaSubmissions.estado, createdAt: ppaSubmissions.createdAt })
      .from(ppaSubmissions).where(eq(ppaSubmissions.workerId, subject.id)).orderBy(desc(ppaSubmissions.createdAt)),
    db.select({
      id: sstDocumentLinks.id,
      documentId: sstDocuments.id,
      title: sstDocuments.title,
      status: sstDocuments.status,
    }).from(sstDocumentLinks).innerJoin(sstDocuments, eq(sstDocumentLinks.documentId, sstDocuments.id))
      .where(and(eq(sstDocumentLinks.entityType, "worker"), eq(sstDocumentLinks.entityId, subject.id), isNull(sstDocumentLinks.removedAt))),
    db.select().from(preventionPrivacyRequestExecutions)
      .where(eq(preventionPrivacyRequestExecutions.requestId, requestRow.id)).orderBy(desc(preventionPrivacyRequestExecutions.createdAt)),
    db.select().from(preventionSubjectProcessingRestrictions)
      .where(eq(preventionSubjectProcessingRestrictions.requestId, requestRow.id)).orderBy(desc(preventionSubjectProcessingRestrictions.appliedAt)),
    db.select().from(preventionPrivacyRequestHistory)
      .where(eq(preventionPrivacyRequestHistory.requestId, requestRow.id)).orderBy(desc(preventionPrivacyRequestHistory.createdAt)),
    db.select().from(preventionPrivacyDeliveries)
      .where(eq(preventionPrivacyDeliveries.requestId, requestRow.id)).orderBy(desc(preventionPrivacyDeliveries.deliveredAt)),
  ])

  // Sólo los expedientes donde el actor es miembro nominado y tiene el permiso
  // reservado. Los demás se reportan como un contador, sin código ni categoría:
  // quien atiende la solicitud necesita saber que existen para no declarar el
  // inventario completo, pero no puede identificarlos.
  const visibleReservedCases = canSeeReserved
    ? reservedCases.filter((row) => row.memberUserId !== null && scopeAllows(args.scope, row.worksiteId))
    : []
  const restrictedReservedCaseCount = reservedCases.length - visibleReservedCases.length

  return {
    request: requestRow,
    subject: {
      id: subject.id,
      name: `${subject.firstName} ${subject.lastName}`.trim(),
      rut: subject.rut,
      worksiteId: subject.worksiteId,
    },
    worksite: worksite[0] ?? null,
    inventory: {
      healthRecords: healthRecords.map((row) => ({
        ...row,
        // La aptitud ocupacional es dato de salud: la protege
        // `health:view_restrictions`, no el permiso de privacidad.
        fitnessStatus: canSeeFitness ? row.fitnessStatus : null,
      })),
      reservedCases: visibleReservedCases,
      ppas,
      documentLinks,
    },
    restrictedReservedCaseCount,
    executions,
    restrictions,
    history,
    deliveries,
  }
}

export async function hasRequiredPrivacyExecutionEvidence(requestId: string, rightType: string) {
  if (["access", "portability"].includes(rightType)) {
    const [delivery] = await db.select({ id: preventionPrivacyDeliveries.id }).from(preventionPrivacyDeliveries)
      .where(eq(preventionPrivacyDeliveries.requestId, requestId)).limit(1)
    return Boolean(delivery)
  }
  if (["rectification", "deletion", "opposition", "restriction"].includes(rightType)) {
    const [execution] = await db.select({ id: preventionPrivacyRequestExecutions.id })
      .from(preventionPrivacyRequestExecutions).where(and(
        eq(preventionPrivacyRequestExecutions.requestId, requestId),
        eq(preventionPrivacyRequestExecutions.operation, rightType),
        inArray(preventionPrivacyRequestExecutions.outcome, ["applied", "partially_applied"]),
      )).limit(1)
    return Boolean(execution)
  }
  return false
}
