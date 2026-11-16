"use server"

import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  boardDataExportSchema,
  boardExportPermissions,
  buildBoardDataWorkbookBase64,
  buildChartDataWorkbookBase64,
  chartDataExportSchema,
  chartExportFilename,
  type BoardDataExportInput,
  type ChartDataExportInput,
} from "@/lib/reports/chart-data-export"
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

/**
 * «Exportar Excel» de la cabecera de un tablero: todas las tablas «Ver datos» de la pantalla en un
 * libro, una hoja por gráfico. Exige **cada** permiso de exportar que declaran sus tablas: una
 * tabla con un permiso que la sesión no tiene no se cuela en el libro de otra (la pantalla sólo
 * ofrece la descarga de las tablas que su permiso habilita, así que un rechazo acá es una petición
 * armada a mano).
 */
export async function exportBoardDataAction(input: BoardDataExportInput): Promise<ExportActionResult> {
  const parsed = boardDataExportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "El tablero no se pudo exportar: sus datos no son válidos." }

  const permissions = boardExportPermissions(parsed.data)
  let session
  try {
    for (const permission of permissions) session = await requirePermission(permission)
  } catch {
    return { ok: false, message: "Sin permisos" }
  }
  if (!session) return { ok: false, message: "Sin permisos" }

  try {
    const base64 = await buildBoardDataWorkbookBase64(session, parsed.data)
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "board_data_export",
      entityId: nanoid(),
      newState: {
        title: parsed.data.title,
        scope: parsed.data.scope,
        tables: parsed.data.tables.map((table) => ({ title: table.title, rowCount: table.rows.length })),
        permissions,
      },
    })
    return { ok: true, data: { base64, filename: chartExportFilename(parsed.data.title, todayInChile()) } }
  } catch (error) {
    logger.error("[exportBoardDataAction]", error)
    return { ok: false, message: "No se pudo exportar el tablero. Intenta nuevamente." }
  }
}
