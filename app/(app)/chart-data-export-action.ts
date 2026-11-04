"use server"

import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { buildChartDataWorkbookBase64, chartDataExportSchema, chartExportFilename, type ChartDataExportInput } from "@/lib/reports/chart-data-export"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"

/**
 * «Ver datos» → Excel (Fase 4 de `AUDITORIA_VISUALIZACIONES_CHOME.md`). Recibe la tabla que el
 * navegador ya muestra y la devuelve como `.xlsx`; no lee ni agrega datos.
 *
 * La guarda es el **permiso de exportar del módulo** que dibuja el gráfico (`*:export`), no la
 * sesión sola: que alguien vea una cifra no le da la descarga. `chartDataExportSchema` sólo admite
 * los permisos de exportación general y acota el tamaño; un permiso inventado o una tabla de 10 MB
 * se rechazan antes de tocar la sesión.
 */
export async function exportChartDataAction(input: ChartDataExportInput): Promise<ExportActionResult> {
  const parsed = chartDataExportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "La tabla no se pudo exportar: sus datos no son válidos." }

  let session
  try {
    session = await requirePermission(parsed.data.permission)
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  try {
    const base64 = await buildChartDataWorkbookBase64(session, parsed.data)
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "chart_data_export",
      entityId: nanoid(),
      newState: { title: parsed.data.title, rowCount: parsed.data.rows.length, permission: parsed.data.permission },
    })
    return { ok: true, data: { base64, filename: chartExportFilename(parsed.data.title, todayInChile()) } }
  } catch (error) {
    logger.error("[exportChartDataAction]", error)
    return { ok: false, message: "No se pudo exportar la tabla. Intenta nuevamente." }
  }
}
