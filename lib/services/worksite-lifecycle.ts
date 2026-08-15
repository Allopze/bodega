import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpObligations,
  pdtpProgramWorksites,
  preventionCapaActions,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import type { WorksiteScope } from "@/lib/auth/scope"
import { transitionCapaActionWithClient } from "@/lib/services/prevention-capa"

const OPEN_CAPA_STATUSES = ["pending", "in_progress", "pending_verification", "reopened"] as const
const OPEN_OBLIGATION_STATUSES = ["pending", "overdue"] as const

interface SetWorksiteActiveInput {
  worksiteId: string
  activate: boolean
  reason?: string
  actorUserId: string
  actorEmail?: string
  scope: WorksiteScope
}

export interface WorksiteLifecycleResult {
  programsDropped: number
  capaCancelled: number
  obligationsCancelled: number
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

/**
 * Cambia el estado operativo de una faena junto con todos sus cierres
 * dependientes. Ningún paso queda confirmado si falla una transición CAPA,
 * una obligación, el audit log o el cambio final de la faena.
 */
export async function setWorksiteActive(input: SetWorksiteActiveInput): Promise<WorksiteLifecycleResult> {
  const reason = input.reason?.trim() ?? ""
  if (!input.activate && reason.length < 10) {
    throw new Error("Indica el motivo del cierre de faena (mínimo 10 caracteres).")
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(worksites)
      .where(eq(worksites.id, input.worksiteId))
      .for("update")
      .limit(1)
    if (!current || !scopeAllows(input.scope, current.id)) {
      throw new Error("Faena no encontrada o fuera de alcance.")
    }
    if (current.isActive === input.activate) {
      return { programsDropped: 0, capaCancelled: 0, obligationsCancelled: 0 }
    }

    const closureReason = `Cierre de faena: ${reason}`
    const programsDropped = input.activate
      ? []
      : await tx.update(pdtpProgramWorksites)
          .set({ isActive: false })
          .where(and(
            eq(pdtpProgramWorksites.worksiteId, current.id),
            eq(pdtpProgramWorksites.isActive, true),
          ))
          .returning({ programId: pdtpProgramWorksites.programId })

    const capaCancelled: string[] = []
    let obligationsCancelled = 0
    if (!input.activate) {
      const openActions = await tx.select().from(preventionCapaActions).where(and(
        eq(preventionCapaActions.worksiteId, current.id),
        inArray(preventionCapaActions.status, [...OPEN_CAPA_STATUSES]),
      ))
      for (const action of openActions) {
        await transitionCapaActionWithClient(tx, {
          actionId: action.id,
          expectedVersion: action.version,
          toStatus: "cancelled",
          reason: closureReason,
        }, {
          ctx: { userId: input.actorUserId },
          scope: input.scope,
          permissions: ["prevention:capa:manage"],
        })
        capaCancelled.push(action.code)
      }

      const cancelled = await tx.update(pdtpObligations).set({
        status: "cancelled",
        cancelledByUserId: input.actorUserId,
        cancelledAt: new Date().toISOString(),
        cancellationReason: closureReason,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(pdtpObligations.worksiteId, current.id),
        inArray(pdtpObligations.status, [...OPEN_OBLIGATION_STATUSES]),
      )).returning({ id: pdtpObligations.id })
      obligationsCancelled = cancelled.length
    }

    await tx.update(worksites).set({
      isActive: input.activate,
      updatedAt: new Date().toISOString(),
    }).where(eq(worksites.id, current.id))

    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail,
      action: "update",
      entityType: "worksite",
      entityId: current.id,
      entityCode: current.code,
      oldState: { isActive: current.isActive },
      newState: {
        isActive: input.activate,
        ...(input.activate ? {} : { closureReason: reason }),
        ...(programsDropped.length > 0
          ? { pdtpProgramsDropped: programsDropped.map((row) => row.programId) }
          : {}),
        ...(capaCancelled.length > 0 ? { capaCancelled } : {}),
        ...(obligationsCancelled > 0 ? { pdtpObligationsCancelled: obligationsCancelled } : {}),
      },
    }, tx)

    return {
      programsDropped: programsDropped.length,
      capaCancelled: capaCancelled.length,
      obligationsCancelled,
    }
  })
}
