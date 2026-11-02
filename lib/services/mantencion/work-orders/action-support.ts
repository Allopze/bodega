import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantWorkOrders } from "@/db/schema"
import { viewerFromSession } from "../access"
import type { LockedResult } from "./core"
import type { WorkOrderActor, WorkOrderResult } from "./types"

/**
 * Piezas comunes de las server actions de la OT. Viven aquí y no en los
 * `actions.ts` porque un archivo `"use server"` sólo puede exportar funciones
 * asíncronas de acción.
 */

export function actorFromSession(session: Session): WorkOrderActor {
  const viewer = viewerFromSession(session)
  return {
    userId: viewer.userId,
    name: session.user.name ?? session.user.email ?? "Usuario",
    permissions: viewer.permissions,
    worksiteIds: viewer.worksiteIds,
    isGlobal: viewer.isGlobal,
  }
}

export interface WorkOrderActionState {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
  data?: { version: number; status: string }
}

/** `WorkOrderResult` → `ActionState`: el mensaje del servicio ya está en español y es mostrable. */
export function toActionState(result: WorkOrderResult | LockedResult): WorkOrderActionState {
  if (result.ok) return { ok: true, data: { version: result.value.version, status: result.value.status } }
  return { ok: false, message: result.message, ...(result.field ? { fieldErrors: { [result.field]: [result.message] } } : {}) }
}

/** Equipo de la OT, para refrescar su hoja de vida después de un cambio. */
export async function workOrderVehicleId(workOrderId: string): Promise<string | null> {
  const [row] = await db.select({ vehicleId: mantWorkOrders.vehicleId }).from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
  return row?.vehicleId ?? null
}
