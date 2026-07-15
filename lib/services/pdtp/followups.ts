/**
 * Servicio de seguimiento (bitácora) del plan de acción PDTP.
 *
 * Cada cambio de estado o evidencia registrada queda como un followup
 * en `pdtp_action_plan_followups`, formando una línea de tiempo.
 */

import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActionPlan, pdtpActionPlanFollowups, pdtpExecutions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { isActionVencida, PDTP_ESTADOS_CERRADOS } from "./checklist-domain"

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

    const estadoAnterior = current.estado
    const estadoNuevo = input.estadoNuevo ?? current.estado

    // Si cambió el estado, actualizar la acción
    if (estadoNuevo !== estadoAnterior) {
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

  return rows.map((r) => r.item).filter((r) => isActionVencida(r.estado, r.plazo))
}
