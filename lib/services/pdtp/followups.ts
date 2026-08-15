/**
 * Servicio de seguimiento (bitácora) del plan de acción PDTP.
 *
 * Cada cambio de estado o evidencia registrada queda como un followup
 * en `pdtp_action_plan_followups`, formando una línea de tiempo.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionCapaActions } from "@/db/schema"
import { capaEstado, listPdtpActionFollowups, listPdtpActionsVencidas } from "./capa-view"
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
    const [initialCapa] = await tx.select().from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.id, input.actionPlanItemId),
        eq(preventionCapaActions.sourceType, "pdtp"),
      )).limit(1)
    if (!initialCapa) throw new Error("Acción no encontrada.")
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

    const estadoAnterior = capaEstado(initialCapa.status)
    const estadoNuevo = input.estadoNuevo ?? estadoAnterior

    // Si cambió el estado, ejecuta la transición CAPA estricta.
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
    }

    // La bitácora ya quedó escrita: cada `addCapaEvidence`, `addCapaFollowup` y
    // transición de arriba insertó su fila en `prevention_capa_transitions`,
    // que es la línea de tiempo que lee `listFollowups`. Escribir además una
    // fila propia duplicaba cada entrada.
    return {
      id: capa.id,
      actionPlanItemId: input.actionPlanItemId,
      fecha: today,
      estadoAnterior,
      estadoNuevo,
      observacion: input.observacion ?? null,
      evidenciaUrl: input.evidenciaUrl ?? null,
      evidenciaPhotos: input.evidenciaPhotos ?? [],
      updatedByUserId: userId,
      createdAt: now,
    }
  })
}

/** Lista la línea de tiempo de seguimiento de una acción. */
export async function listFollowups(actionPlanItemId: string) {
  return listPdtpActionFollowups(actionPlanItemId)
}

/** Lista todas las acciones vencidas (pendiente/en_proceso/reabierto con plazo pasado). */
export async function listVencidas(programId?: string) {
  return listPdtpActionsVencidas(programId)
}
