/**
 * Servicio de seguimiento (bitácora) del plan de acción PDTP.
 *
 * Cada cambio de estado o evidencia registrada queda como un followup
 * en `pdtp_action_plan_followups`, formando una línea de tiempo.
 */

import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActionPlan, pdtpActionPlanFollowups, pdtpExecutions, preventionCapaActions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { isActionVencida, PDTP_ESTADOS_CERRADOS } from "./checklist-domain"
import {
  addCapaEvidenceWithClient,
  addCapaFollowupWithClient,
  transitionCapaActionWithClient,
} from "@/lib/services/prevention-capa"

function capaAccess(userId: string) {
  return {
    ctx: { userId },
    scope: { mode: "all" as const, ids: [] as [] },
    permissions: ["prevention:capa:manage", "prevention:capa:complete"],
  }
}

export type PdtpFollowupInput = {
  actionPlanItemId: string
  observacion?: string
  estadoNuevo?: string
  evidenciaUrl?: string
  evidenciaPhotos?: string[]
}

/** Registra un followup y opcionalmente transiciona el estado de la acción. */
export async function addFollowup(input: PdtpFollowupInput, userId: string) {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(pdtpActionPlan)
      .where(eq(pdtpActionPlan.id, input.actionPlanItemId)).limit(1)
    if (!current) throw new Error("Acción no encontrada.")
    if (!current.capaActionId) throw new Error("La acción no tiene CAPA vinculada y requiere conciliación.")
    const [initialCapa] = await tx.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, current.capaActionId)).limit(1)
    if (!initialCapa) throw new Error("La acción CAPA vinculada no existe.")
    let capa = initialCapa
    const access = capaAccess(userId)

    if (input.evidenciaUrl) {
      const result = await addCapaEvidenceWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        kind: "document",
        reference: input.evidenciaUrl,
        description: input.observacion || "Evidencia documental PDTP",
      }, access)
      capa = result.action!
    }
    for (const photo of input.evidenciaPhotos ?? []) {
      const result = await addCapaEvidenceWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        kind: "photo",
        reference: photo,
        description: input.observacion || "Evidencia fotográfica PDTP",
      }, access)
      capa = result.action!
    }
    if (input.observacion?.trim()) {
      const result = await addCapaFollowupWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        note: input.observacion,
      }, access)
      capa = result.action!
    }

    const estadoAnterior = current.estado
    const estadoNuevo = input.estadoNuevo ?? current.estado

    // Si cambió el estado, primero ejecuta la transición CAPA estricta.
    if (estadoNuevo !== estadoAnterior) {
      if (estadoNuevo === "en_proceso") {
        if (!["pending", "reopened"].includes(capa.status)) throw new Error("La CAPA no puede pasar a en proceso desde su estado actual.")
        capa = await transitionCapaActionWithClient(tx, {
          actionId: capa.id, expectedVersion: capa.version, toStatus: "in_progress",
          reason: input.observacion || "Implementación PDTP iniciada.",
        }, access)
      } else if (estadoNuevo === "completado") {
        if (capa.status === "pending" || capa.status === "reopened") {
          capa = await transitionCapaActionWithClient(tx, {
            actionId: capa.id, expectedVersion: capa.version, toStatus: "in_progress",
            reason: "Implementación PDTP iniciada.",
          }, access)
        }
        if (capa.status !== "in_progress") throw new Error("La CAPA no está en implementación.")
        capa = await transitionCapaActionWithClient(tx, {
          actionId: capa.id, expectedVersion: capa.version, toStatus: "pending_verification",
          reason: input.observacion || "Implementación PDTP declarada.",
        }, access)
      } else {
        throw new Error("Usa los controles dedicados para reabrir, verificar o cancelar una acción.")
      }
      const set: Record<string, unknown> = {
        estado: estadoNuevo,
        updatedAt: now,
      }
      if (estadoNuevo === "completado") set.closedAt = now
      await tx.update(pdtpActionPlan).set(set)
        .where(eq(pdtpActionPlan.id, input.actionPlanItemId))
    }

    const [followup] = await tx.insert(pdtpActionPlanFollowups).values({
      id: nanoid(),
      actionPlanItemId: input.actionPlanItemId,
      fecha: today,
      estadoAnterior,
      estadoNuevo,
      observacion: input.observacion ?? null,
      evidenciaUrl: input.evidenciaUrl ?? null,
      evidenciaPhotos: (input.evidenciaPhotos ?? []) as unknown as Record<string, unknown>,
      updatedByUserId: userId,
      createdAt: now,
    }).returning()

    return followup!
  })
}

/** Lista la línea de tiempo de seguimiento de una acción. */
export async function listFollowups(actionPlanItemId: string) {
  return db.select().from(pdtpActionPlanFollowups)
    .where(eq(pdtpActionPlanFollowups.actionPlanItemId, actionPlanItemId))
    .orderBy(desc(pdtpActionPlanFollowups.createdAt))
}

/** Lista todas las acciones vencidas (pendiente/en_proceso/reabierto con plazo pasado). */
export async function listVencidas(programId?: string) {
  const rows = await db.select({ item: pdtpActionPlan })
    .from(pdtpActionPlan)
    .innerJoin(pdtpExecutions, eq(pdtpActionPlan.executionId, pdtpExecutions.id))
    .where(and(
      notInArray(pdtpActionPlan.estado, [...PDTP_ESTADOS_CERRADOS]),
      programId
        ? sql`EXISTS (
            SELECT 1 FROM pdtp_activities a
            WHERE a.id = ${pdtpExecutions.activityId}
            AND a.program_id = ${programId}
          )`
        : sql`true`,
    ))

  return rows.reduce<typeof pdtpActionPlan.$inferSelect[]>((overdue, row) => {
    if (isActionVencida(row.item.estado, row.item.plazo)) overdue.push(row.item)
    return overdue
  }, [])
}
