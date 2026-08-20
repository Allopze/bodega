"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requirePermission } from "@/lib/auth/can"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { classifyDteFailure } from "@/lib/services/dte-portal/failure"
import { assertSyncablePeriodo, syncDteDocuments } from "@/lib/services/dte-portal/sync"

export interface DteSyncActionResult {
  ok: boolean
  message: string
}

/**
 * Dispara una sincronización manual del mes en curso contra la Bandeja de
 * Entrada del portal DTE. Mismo servicio que usa el cron
 * (app/api/cron/dte-portal-sync) y la API pública (app/api/dte-portal/sync).
 *
 * El mes en curso siempre se re-consulta — `syncDteDocuments` sólo salta por
 * "ya sincronizado" en períodos ya cerrados (H-03, AUDITORIA_BUGS_2026-08-05.md).
 * Firma sin argumentos porque `useActionState` la llama con `(prevState,
 * formData)`; para forzar un período específico usa `forceDteSyncPeriodAction`.
 */
export async function triggerDteSyncAction(): Promise<DteSyncActionResult> {
  return runDteSync({})
}

/**
 * Fuerza la re-sincronización de un período específico, incluso si ya se
 * había dado por sincronizado. Para el mes en curso no hace falta: el botón
 * de arriba ya lo re-consulta siempre.
 */
export async function forceDteSyncPeriodAction(input: { periodo: string }): Promise<DteSyncActionResult> {
  const parsed = z.object({ periodo: z.string() }).safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Indique el período a forzar en formato YYYY-MM." }
  }
  return runDteSync({ periodo: parsed.data.periodo, force: true })
}

async function runDteSync(options: { periodo?: string; force?: boolean }): Promise<DteSyncActionResult> {
  try {
    const session = await requirePermission("admin:dte_sync")

    // El período llega de un desplegable, pero un `2026-13` o un mes futuro
    // terminaban en el catch genérico: el operador leía "falló de forma
    // inesperada" en vez del motivo, que es accionable y no revela nada.
    if (options.periodo) {
      try {
        assertSyncablePeriodo(options.periodo)
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Período inválido." }
      }
    }

    if (!(await isDteSyncEnabled())) {
      return { ok: false, message: "La sincronización DTE no está habilitada. Configure las credenciales del portal en esta misma página o DTE_SYNC_ENABLED=true." }
    }

    const client = new DtePortalClient(await buildDtePortalClientConfig())
    const result = await syncDteDocuments(client, {
      trigger: "manual",
      importerId: session.user.id,
      periodo: options.periodo,
      force: options.force,
    })

    revalidatePath("/admin/dte")

    if (result.status === "failed") {
      return { ok: false, message: "La sincronización DTE falló. Revise el historial de corridas para el código seguro." }
    }
    if (result.status === "skipped") {
      if (result.skipReason === "disabled") {
        return { ok: false, message: "La sincronización está pausada temporalmente por un cambio seguro de credenciales." }
      }
      if (result.skipReason === "active_run") {
        return { ok: false, message: "Ya hay una sincronización DTE activa para este período. Espere a que termine." }
      }
      return { ok: true, message: "Ya existe una corrida exitosa para este período cerrado. Usa \"Forzar\" para re-sincronizarlo." }
    }

    const suffix = result.status === "partial" ? " Se detectaron pendientes; revise el historial de corridas." : ""
    return { ok: true, message: `Sincronizado ${result.periodo}: ${result.rowsInserted} nuevos, ${result.rowsUpdated} actualizados de ${result.rowsSeen} vistos${suffix}` }
  } catch (error) {
    const failure = classifyDteFailure(error)
    return { ok: false, message: failure.summary }
  }
}
