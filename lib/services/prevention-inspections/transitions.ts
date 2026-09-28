import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionInspectionFindings,
  preventionInspectionRuns,
  preventionInspectionTemplates,
} from "@/db/schema"
import { history, NOT_FOUND, nowIso, requireAccess, scopeAllows, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import {
  assertInspectionRunTransition,
  TRANSITION_REASON_MIN_LENGTH,
  type InspectionRunStatus,
} from "@/lib/prevention/inspections"
import { onInspectionCompleted, onInspectionReverted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"

/* ── Motor de transiciones ────────────────────────────────────────────────
 * Puerta única para revisar, cancelar y reabrir. Copia la estructura de
 * `transitionCapaActionWithClient` (lib/services/prevention-capa.ts): guarda
 * pura + doble CAS (chequeo previo y UPDATE condicionado por estado y versión)
 * + historial + actividad operacional.
 */

const runTransitionSchema = z.object({
  runId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["in_progress", "reviewed", "cancelled"]),
  reason: z.string().trim().max(3000).optional(),
})

/** Campos que cada destino escribe, más allá del estado y la versión. */
function transitionChangeSet(toStatus: string, actorUserId: string, reason: string | undefined, now: string) {
  if (toStatus === "reviewed") {
    return { reviewedByUserId: actorUserId, reviewedAt: now, reviewComment: reason ?? null }
  }
  if (toStatus === "cancelled") {
    // El CHECK `prevention_inspection_run_cancel_consistent` exige los tres juntos.
    return { cancelledByUserId: actorUserId, cancelledAt: now, cancellationReason: reason ?? null }
  }
  // Reabrir: la ejecución deja de existir, así que se limpia todo lo que la
  // declaraba. Conservar `compliancePercent` afirmaría un resultado que ya no
  // corresponde a ninguna respuesta cerrada.
  return {
    executedByUserId: null, executedAt: null,
    reviewedByUserId: null, reviewedAt: null, reviewComment: null,
    compliancePercent: null,
    officialComplianceBasisPoints: null,
    normalizedComplianceBasisPoints: null,
    conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
  }
}

export async function transitionInspectionRun(input: unknown, access: InspectionAccess) {
  const data = runTransitionSchema.parse(input)

  // La acreditación de revisión y su reversión comparten esta transacción. La
  // firma de la inspección y el cumplimiento anual son una única verdad de BD:
  // o se confirman ambos, o ninguno.
  const result = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    // El alcance de faena se comprueba siempre; el permiso concreto lo decide
    // la guarda según el destino.
    if (!scopeAllows(access.scope, run.worksiteId)) throw new Error(NOT_FOUND)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    const findings = await tx.select().from(preventionInspectionFindings)
      .where(eq(preventionInspectionFindings.runId, run.id))

    // Quién es el ejecutante de registro lo declara la plantilla: en el report de
    // uso diario lo ejecuta el operador en papel y quien completa el run sólo lo
    // transcribe, así que el candado de independencia no debe bloquearle la firma
    // (D04). Ver `assessRunReview`.
    const [runTemplate] = await tx.select({ executorOfRecord: preventionInspectionTemplates.executorOfRecord })
      .from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)

    assertInspectionRunTransition({
      fromStatus: run.status as InspectionRunStatus,
      toStatus: data.toStatus,
      permissions: access.permissions,
      actorUserId: access.userId,
      executedByUserId: run.executedByUserId,
      executorOfRecord: runTemplate?.executorOfRecord ?? null,
      reason: data.reason,
      findings: findings.map((finding) => ({
        id: finding.id,
        description: finding.description,
        criticality: finding.criticality,
        capaActionId: finding.capaActionId,
        status: finding.status,
      })),
    })

    const now = nowIso()

    if (data.toStatus === "in_progress") {
      /* Los hallazgos con CAPA sobreviven: la acción correctiva ya vive en otro
       * módulo y borrarla en cascada destruiría evidencia. Es la misma
       * sentencia que usa `completeInspectionRun` al rehacerlos.
       *
       * Las desviaciones también sobreviven: son lo que una persona encontró en
       * terreno, no un artefacto recalculable a partir de las respuestas.
       * Reabrir para corregir un dato no puede obligar a volver a escribirlas. */
      await tx.delete(preventionInspectionFindings).where(and(
        eq(preventionInspectionFindings.runId, run.id),
        eq(preventionInspectionFindings.origin, "derived"),
        sql`${preventionInspectionFindings.capaActionId} IS NULL`,
      ))
    }

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: data.toStatus,
      ...transitionChangeSet(data.toStatus, access.userId, data.reason, now),
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.status, run.status),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: data.toStatus === "in_progress" ? "reopened" : data.toStatus,
      reason: data.reason ?? "",
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    await recordOperationalActivity({
      // La reapertura anula un `compliancePercent` ya publicado: sin su propio
      // evento, la serie temporal no puede explicar la discontinuidad.
      eventType: data.toStatus === "in_progress" ? "inspection.reopened" : `inspection.${data.toStatus}`,
      module: "inspecciones",
      entityType: "inspection_run",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.userId,
      payload: { status: updated.status },
    }, tx)

    // El programa distingue ejecutar de revisar y firmar, y les pone
    // responsables distintos. La firma es este acto, no el anterior: acá el
    // servicio ya garantizó que el revisor no es quien ejecutó
    // (`assertInspectionRunTransition` → `assessRunReview`), que es justo la
    // independencia que la actividad exige.
    if (data.toStatus === "reviewed") {
      const [template] = await tx.select({ numbers: preventionInspectionTemplates.pdtpReviewActivityNumbers })
        .from(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
      const activityNumbers = Array.isArray(template?.numbers) ? template.numbers : []
      const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: run.templateId, eventType: "review", legacyActivityNumbers: activityNumbers }, tx)
      if (target.catalogActivityIds?.length || target.activityNumbers?.length) {
        await onInspectionCompleted({
          runId: run.id,
          worksiteId: run.worksiteId,
          completedAt: updated.reviewedAt ?? now,
          completedByUserId: access.userId,
          ...target,
        }, tx)
      }
    }
    // Sólo se revoca lo que alguna vez se acreditó: un run que nunca pasó de
    // `planned` no tiene nada que devolver, y llamar igual gastaría una consulta
    // por cada cancelación de una inspección jamás ejecutada.
    if ((data.toStatus === "cancelled" || data.toStatus === "in_progress") && run.executedAt) {
      await onInspectionReverted({
        runId: run.id,
        worksiteId: run.worksiteId,
        reason: data.toStatus === "cancelled"
          ? `Inspección ${run.code} cancelada: ${data.reason ?? "sin motivo declarado"}`
          : `Inspección ${run.code} reabierta para rectificar: ${data.reason ?? "sin motivo declarado"}`,
        revokedBy: access.userId,
      }, tx)
    }
    // La revisión firma el informe: es una copia nueva en Cloudreve, además de
    // la que dejó el cierre en `completed`.
    if (data.toStatus === "reviewed") {
      await enqueueGeneratedDocumentTx(tx, {
        kind: "inspeccion",
        entityId: updated.id,
        milestone: "revisada",
        revision: updated.version,
        worksiteId: updated.worksiteId,
        occurredAt: now,
        actorUserId: access.userId,
      })
    }
    return updated
  })

  return result
}

/**
 * Reasignar el ejecutante de una inspección aún no ejecutada (función #12).
 *
 * Función hermana del motor de transiciones, no un destino más: no cambia de
 * estado. Meter cambios de campo arbitrarios en `transitionInspectionRun` lo
 * convertiría en un `update` genérico y le haría perder su valor como guarda.
 */
export async function reassignInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    assignedToUserId: z.string().min(1).nullable(),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", run.worksiteId)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (!["planned", "in_progress"].includes(run.status)) {
      throw new Error("Sólo puede reasignarse una inspección que aún no fue ejecutada.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionRuns).set({
      assignedToUserId: data.assignedToUserId,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "reassigned", reason: data.reason,
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}
