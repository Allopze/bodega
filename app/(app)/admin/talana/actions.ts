"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { DIFFERENCE_META } from "@/lib/integrations/talana/talana-differences"
import { acceptTalanaFusible, filterByWorksiteScope, listTalanaRunItems, listTalanaRuns, loadTalanaDifferences } from "@/lib/integrations/talana/talana-read"
import { logger } from "@/lib/logger"
import { EXCEL_DATETIME_FORMAT, excelDateTime } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportData } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { FIX_IN_LABELS, ITEM_KIND_LABELS, RUN_MODE_LABELS, itemOutcomeMeta, itemReasonLabel } from "./talana-labels"

const PAGE = "/admin/talana"

export interface TalanaActionResult {
  ok: boolean
  message?: string
}

/**
 * Rearma el fusible: alguien revisó lo que Talana envió y la próxima corrida
 * podrá aplicar. Sólo quien tiene `admin:workers_hr`; el servicio comprueba que
 * la corrida siga bloqueada y sin aceptar (dos personas pulsando a la vez).
 */
export async function acceptTalanaFusibleAction(input: { runId: string }): Promise<TalanaActionResult> {
  const guard = await guardPermission("admin:workers_hr", PAGE)
  if (guard.error) return guard.error

  const parsed = z.object({ runId: z.string().min(1).max(64) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce la corrida." }

  try {
    const accepted = await acceptTalanaFusible(parsed.data.runId, {
      userId: guard.session.user.id,
      email: guard.session.user.email,
    })
    if (!accepted) {
      revalidatePath(PAGE)
      return { ok: false, message: "Esa corrida ya no está detenida o ya fue revisada. Se actualizó la pantalla." }
    }
    revalidatePath(PAGE)
    return { ok: true, message: "Fusible rearmado: la próxima corrida podrá aplicar los cambios." }
  } catch (error) {
    logger.error("[talana:acceptFusible]", error)
    return { ok: false, message: "No se pudo rearmar el fusible. Inténtalo de nuevo." }
  }
}

const DIFFERENCE_HEADERS = ["Trabajador", "RUT", "Diferencia", "Detalle", "Corregir en"]
const CHANGE_HEADERS = ["Trabajador", "RUT", "Faena", "Cambio", "Antes", "Después", "Resultado", "Motivo", "Corrida"]
const RUN_COLUMN = 8

/**
 * Excel con lo que la pantalla muestra: las diferencias de hoy y los cambios de
 * la última corrida. Se filtra con el mismo alcance de faena que la pantalla.
 */
export async function exportTalanaXlsxAction() {
  const guard = await guardPermission("admin:workers_hr", PAGE)
  if (guard.error) return { ok: false as const, message: "Sin permisos para exportar la información de Talana" }
  const { session } = guard

  try {
    const [{ differences }, runs] = await Promise.all([loadTalanaDifferences(), listTalanaRuns(1)])
    const scopedDifferences = filterByWorksiteScope(session, differences)
    const latestRun = runs[0] ?? null
    const items = latestRun ? filterByWorksiteScope(session, await listTalanaRunItems(latestRun.id)) : []

    const report: ReportData = {
      filenameBase: "talana",
      worksheetName: "Diferencias",
      headers: DIFFERENCE_HEADERS,
      rows: scopedDifferences.map((difference) => [
        difference.personLabel,
        difference.rut ?? "",
        DIFFERENCE_META[difference.code].label,
        difference.detail,
        FIX_IN_LABELS[difference.fixIn],
      ]),
      sheets: [{
        worksheetName: "Cambios de la última corrida",
        headers: CHANGE_HEADERS,
        rows: items.map((item) => [
          item.displayName,
          item.rut ?? "",
          item.worksiteName ?? "",
          ITEM_KIND_LABELS[item.kind],
          item.beforeLabel ?? "",
          item.afterLabel ?? "",
          itemOutcomeMeta(item.outcome).label,
          itemReasonLabel(item.reasonCode) ?? "",
          latestRun ? excelDateTime(latestRun.startedAt) : null,
        ]),
        columnFormats: { [RUN_COLUMN]: EXCEL_DATETIME_FORMAT },
      }],
    }

    const buffer = await buildXlsxBuffer(report, {
      session,
      filters: {
        corrida: latestRun
          ? `${RUN_MODE_LABELS[latestRun.mode] ?? latestRun.mode} del ${latestRun.startedAt.slice(0, 10)}`
          : "Sin corridas",
      },
    })
    const base64 = Buffer.from(buffer).toString("base64")

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "talana_export",
      entityId: nanoid(),
      newState: { differences: scopedDifferences.length, changes: items.length, runId: latestRun?.id ?? null },
    })

    return { ok: true as const, data: { base64, filename: `talana_${todayInChile()}.xlsx` } }
  } catch (error) {
    logger.error("[talana:export]", error)
    return { ok: false as const, message: "No se pudo generar el Excel. Inténtalo de nuevo." }
  }
}
