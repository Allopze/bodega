"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  getFleetAdminSettings,
  updateSystemSettingNumber,
} from "@/lib/services/system-settings"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/flota-catalogos"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

export async function saveFleetAdminSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:fleet_catalog")
  } catch {
    return errorState("Sin permisos")
  }

  const warningDaysRaw = (formData.get("warningDays") as string | null)?.trim()
  const status = (formData.get("defaultVehicleStatus") as string | null)?.trim() || "operativo"

  const warningDays = Number(warningDaysRaw)
  if (!Number.isInteger(warningDays) || warningDays < 1 || warningDays > 365) {
    return errorState("Los días de aviso de documentos deben estar entre 1 y 365")
  }

  try {
    const before = await getFleetAdminSettings()
    await updateSystemSettingNumber({
      key:    "fleet.document.warning_days",
      value:  warningDays,
      min:    1,
      max:    365,
    })
    await updateSystemSettingNumber({
      key:    "fleet.default_vehicle_status",
      value:  status,
      min:    0,
      max:    0,
    })

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "fleet_admin_setting",
      entityId:   "both",
      oldState:   { ...before },
      newState:   { warningDays, defaultVehicleStatus: status },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Parámetros de flota actualizados" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
