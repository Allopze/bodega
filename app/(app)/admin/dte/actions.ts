"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { syncDteDocuments } from "@/lib/services/dte-portal/sync"

export interface DteSyncActionResult {
  ok: boolean
  message: string
}

/**
 * Dispara una sincronización manual del mes actual contra la Bandeja de
 * Entrada del portal DTE. Mismo servicio que usa el cron
 * (app/api/cron/dte-portal-sync) y la API pública (app/api/dte-portal/sync).
 */
export async function triggerDteSyncAction(): Promise<DteSyncActionResult> {
  try {
    const session = await requirePermission("admin:dte_sync")

    if (!isDteSyncEnabled()) {
      return { ok: false, message: "La sincronización DTE no está habilitada. Configure DTE_SYNC_ENABLED=true y las credenciales del portal." }
    }

    const client = new DtePortalClient(buildDtePortalClientConfig())
    const result = await syncDteDocuments(client, { trigger: "manual", importerId: session.user.id })

    revalidatePath("/admin/dte")

    if (result.status === "failed") {
      return { ok: false, message: result.error ?? "La sincronización falló" }
    }
    if (result.status === "skipped") {
      return { ok: true, message: "Ya existe una corrida exitosa para este período. No se sincronizó de nuevo." }
    }

    const suffix = result.status === "partial" ? ` (${result.error})` : ""
    return { ok: true, message: `Sincronizado: ${result.rowsInserted} nuevos, ${result.rowsUpdated} actualizados de ${result.rowsSeen} vistos${suffix}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de sincronización DTE"
    const safeMessage = message.includes("clave") || message.includes("rut_usr")
      ? "Error de configuración del portal DTE"
      : message
    return { ok: false, message: safeMessage }
  }
}
