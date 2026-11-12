import { and, eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  preventionCapaActions, preventionCapaEvidence, preventionCapaTransitions, preventionInspectionFindings,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { formatDate } from "@/lib/utils"
import { OtRefusal } from "./core"

/**
 * Conformidad de la OT ↔ acción correctiva (CAPA) del hallazgo que la originó.
 *
 * Cerrar la OT (la «Recepción en faena») acredita la CAPA: sin esto el mecánico
 * repara, la faena da su conformidad, y la CAPA queda trabada pidiendo una
 * evidencia que ya existe en otro módulo (la transición
 * `in_progress → pending_verification` la exige cuando `evidenceRequired`, y el
 * conteo descarta las de tipo `note`).
 *
 * Se escribe la fila directamente y no vía `addCapaEvidenceWithClient`: ese
 * servicio exige `prevention:capa:complete` al actor, y quien da la conformidad
 * es un administrador de contrato que no lo tiene. Es evidencia generada por el
 * sistema, no declarada por una persona; acoplarla a un permiso de Prevención
 * rompería el flujo por el lado equivocado.
 *
 * La referencia `mantencion:ot:<id>` cae bajo el prefijo `mantencion:` que
 * `prevention-capa.ts` ya reserva para evidencia automática.
 */

export interface CapaLinkedWorkOrder {
  id: string
  folio: string
  inspectionFindingId: string | null
}

export const capaEvidenceReference = (workOrderId: string) => `mantencion:ot:${workOrderId}`

export async function activateWorkOrderCapaEvidence(
  client: Tx,
  args: { workOrder: CapaLinkedWorkOrder; actorUserId: string; conformedOn: string },
) {
  if (!args.workOrder.inspectionFindingId) return
  const [finding] = await client.select({
    id: preventionInspectionFindings.id,
    capaActionId: preventionInspectionFindings.capaActionId,
    status: preventionInspectionFindings.status,
  })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, args.workOrder.inspectionFindingId)).for("update").limit(1)
  if (!finding) return
  if (!finding.capaActionId) {
    /* El hallazgo sigue vivo pero ya no tiene acción correctiva: cancelar la CAPA
     * en Prevención lo devuelve a `open` y suelta `capa_action_id`
     * (`prevention-capa.ts`). Salir en silencio dejaba cerrar la OT con el
     * hallazgo abierto y sin evidencia, y el guard de «CAPA cancelada» de más
     * abajo nunca se alcanzaba. Un hallazgo ya cerrado por Prevención sin CAPA
     * no tiene nada que acreditar y no bloquea. */
    if (finding.status === "closed") return
    throw new OtRefusal(
      "La acción correctiva del hallazgo fue cancelada en Prevención: no se puede dar la conformidad hasta que Prevención la reactive o derive una nueva.",
      "conflict",
    )
  }
  const [capa] = await client.select({
    id: preventionCapaActions.id,
    status: preventionCapaActions.status,
    startedByUserId: preventionCapaActions.startedByUserId,
    startedAt: preventionCapaActions.startedAt,
  }).from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, finding.capaActionId)).for("update").limit(1)
  if (!capa) return
  if (capa.status === "cancelled") {
    throw new OtRefusal("La acción correctiva vinculada está cancelada; reactívala antes de dar la conformidad de la OT", "conflict")
  }
  const reference = capaEvidenceReference(args.workOrder.id)
  const description = `Evidencia automática de la OT ${args.workOrder.folio}, con conformidad de la faena el ${formatDate(args.conformedOn)}.`
  const now = new Date().toISOString()
  const [evidence] = await client.insert(preventionCapaEvidence).values({
    id: nanoid(),
    actionId: finding.capaActionId,
    kind: "document",
    reference,
    description,
    uploadedByUserId: args.actorUserId,
    status: "active",
    createdAt: now,
  }).onConflictDoUpdate({
    target: [preventionCapaEvidence.actionId, preventionCapaEvidence.reference],
    set: {
      kind: "document",
      description,
      checksumSha256: null,
      uploadedByUserId: args.actorUserId,
      status: "active",
      supersededAt: null,
      supersededByUserId: null,
      supersessionReason: null,
      createdAt: now,
    },
  }).returning({ id: preventionCapaEvidence.id })
  if (!evidence) throw new Error("No se pudo acreditar la OT en CAPA")
  await client.insert(preventionCapaTransitions).values({
    id: `capat-${nanoid()}`,
    actionId: finding.capaActionId,
    changeType: "evidence",
    reason: "Evidencia de la OT de mantención activada",
    changeSet: { evidenceId: evidence.id, lifecycle: "activated", workOrderId: args.workOrder.id },
    actorUserId: args.actorUserId,
    createdAt: now,
  })

  await client.update(preventionInspectionFindings).set({
    status: "closed",
    closedByUserId: args.actorUserId,
    closedAt: now,
    updatedAt: now,
  }).where(eq(preventionInspectionFindings.id, finding.id))

  if (["pending", "in_progress", "reopened"].includes(capa.status)) {
    const startsFromPending = capa.status === "pending" || capa.status === "reopened"
    if (startsFromPending) {
      await client.insert(preventionCapaTransitions).values({
        id: `capat-${nanoid()}`,
        actionId: capa.id,
        changeType: "status",
        fromStatus: capa.status,
        toStatus: "in_progress",
        reason: "OT de mantención ejecutada",
        changeSet: { workOrderId: args.workOrder.id, lifecycle: "started" },
        actorUserId: args.actorUserId,
        createdAt: now,
      })
    }
    await client.update(preventionCapaActions).set({
      status: "pending_verification",
      startedByUserId: capa.startedByUserId ?? args.actorUserId,
      startedAt: capa.startedAt ?? now,
      completedByUserId: args.actorUserId,
      completedAt: now,
      effectivenessStatus: "pending",
      effectivenessAssessment: null,
      effectivenessAssessedByUserId: null,
      effectivenessAssessedAt: null,
      version: sql`${preventionCapaActions.version} + 1`,
      updatedAt: now,
    }).where(eq(preventionCapaActions.id, capa.id))
    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`,
      actionId: capa.id,
      changeType: "status",
      fromStatus: startsFromPending ? "in_progress" : capa.status,
      toStatus: "pending_verification",
      reason: "OT de mantención con conformidad de la faena",
      changeSet: { workOrderId: args.workOrder.id, lifecycle: "completed" },
      actorUserId: args.actorUserId,
      createdAt: now,
    })
  }
}

export async function supersedeWorkOrderCapaEvidence(
  client: Tx,
  args: { workOrder: Pick<CapaLinkedWorkOrder, "id" | "inspectionFindingId">; actorUserId: string; reason: string },
) {
  if (!args.workOrder.inspectionFindingId) return
  const [finding] = await client.select({
    id: preventionInspectionFindings.id,
    capaActionId: preventionInspectionFindings.capaActionId,
  })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, args.workOrder.inspectionFindingId)).for("update").limit(1)
  // Sin CAPA enlazada (cancelada o soltada) no hay evidencia que reemplazar ni
  // acción que reabrir: reabrir la OT no debe depender del estado en Prevención.
  if (!finding?.capaActionId) return
  const [capa] = await client.select({
    id: preventionCapaActions.id,
    status: preventionCapaActions.status,
  }).from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, finding.capaActionId)).for("update").limit(1)
  if (!capa) return
  if (["verified", "closed", "cancelled"].includes(capa.status)) {
    throw new OtRefusal(
      capa.status === "cancelled"
        ? "La CAPA vinculada está cancelada y no puede reabrirse desde Mantención."
        : "La CAPA vinculada ya fue verificada o cerrada; debe reabrirla un usuario autorizado de Prevención antes de reabrir la OT.",
      "conflict",
    )
  }
  const now = new Date().toISOString()
  const [evidence] = await client.update(preventionCapaEvidence).set({
    status: "superseded",
    supersededAt: now,
    supersededByUserId: args.actorUserId,
    supersessionReason: args.reason,
  }).where(and(
    eq(preventionCapaEvidence.actionId, finding.capaActionId),
    eq(preventionCapaEvidence.reference, capaEvidenceReference(args.workOrder.id)),
    eq(preventionCapaEvidence.status, "active"),
  )).returning({ id: preventionCapaEvidence.id })
  if (evidence) {
    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`,
      actionId: finding.capaActionId,
      changeType: "evidence",
      reason: args.reason,
      changeSet: { evidenceId: evidence.id, lifecycle: "superseded", workOrderId: args.workOrder.id },
      actorUserId: args.actorUserId,
      createdAt: now,
    })
  }

  await client.update(preventionInspectionFindings).set({
    status: "capa_linked",
    closedByUserId: null,
    closedAt: null,
    updatedAt: now,
  }).where(eq(preventionInspectionFindings.id, finding.id))

  if (capa.status === "pending_verification") {
    await client.update(preventionCapaActions).set({
      status: "reopened",
      completedByUserId: null,
      completedAt: null,
      verifiedByUserId: null,
      verifiedAt: null,
      closedByUserId: null,
      closedAt: null,
      effectivenessStatus: "pending",
      effectivenessAssessment: null,
      effectivenessAssessedByUserId: null,
      effectivenessAssessedAt: null,
      reopenedByUserId: args.actorUserId,
      reopenedAt: now,
      reopenedReason: args.reason,
      cancelledByUserId: null,
      cancelledAt: null,
      cancellationReason: null,
      version: sql`${preventionCapaActions.version} + 1`,
      updatedAt: now,
    }).where(eq(preventionCapaActions.id, capa.id))
    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`,
      actionId: capa.id,
      changeType: "status",
      fromStatus: capa.status,
      toStatus: "reopened",
      reason: args.reason,
      changeSet: { workOrderId: args.workOrder.id, lifecycle: "reopened" },
      actorUserId: args.actorUserId,
      createdAt: now,
    })
  }
}
