"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { retireAsset } from "@/lib/services/ti/retirements"
import { itRetirementSchema } from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

export async function retireAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para dar de baja activos" } }

  const parsed = parseZ(itRetirementSchema, {
    assetId: formData.get("assetId"),
    date: formData.get("date"),
    reason: formData.get("reason"),
    responsibleUserId: formData.get("responsibleUserId"),
    authorizedByUserId: formData.get("authorizedByUserId"),
    destination: formData.get("destination"),
    observations: formData.get("observations"),
  }, "Revisa los datos de la baja")
  if (!parsed.ok) return parsed

  try {
    await retireAsset(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath("/ti/bajas")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Baja registrada. El historial del activo se conserva." }
  } catch (error) {
    logger.error("[ti:retireAsset]", error)
    return { ok: false, message: safeActionMessage(error, "Error al dar de baja el activo") }
  }
}
