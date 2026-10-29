"use server"

import { z } from "zod"
import type { ExportActionResult } from "@/components/ui/export-button"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { exportEquipmentHistory } from "@/lib/services/mantencion/export-equipment-history"

/**
 * «Exportar historial» de la ficha: Excel con las mantenciones del equipo.
 * Pide `mant:export` EN el servidor; el servicio vuelve a comprobar que el
 * equipo esté en el alcance de faenas de quien exporta y recorta los registros
 * por visibilidad. Ocultar el botón no es control de acceso.
 */
const idSchema = z.string().trim().min(1).max(64)

export async function exportEquipmentHistoryAction(vehicleId: string): Promise<ExportActionResult> {
  const guard = await guardPermission("mant:export", "/mantencion/equipos")
  if (guard.error) return guard.error
  const parsed = idSchema.safeParse(vehicleId)
  if (!parsed.success) return { ok: false, message: "No se pudo preparar la exportación." }
  try {
    const result = await exportEquipmentHistory(guard.session, parsed.data)
    return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message }
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar el Excel.")
  }
}
