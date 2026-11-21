"use server"

import { z } from "zod"
import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  boardDataExportSchema,
  boardExportPermissions,
  buildBoardDataWorkbookBase64,
  chartExportFilename,
} from "@/lib/reports/chart-data-export"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadMaintenanceWork, resolvePanelEquipment } from "@/lib/services/mantencion/maintenance-work"
import { WORK_SHEET_HEADERS, workSheetRow } from "@/lib/services/mantencion/maintenance-work-sheet"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"

/**
 * «Exportar Excel» del Panel de mantención. Es el libro del tablero (una hoja por gráfico, copia de la pantalla,
 * como `exportBoardDataAction`) MÁS la hoja «Trabajos»: cada trabajo de mantención del período, con el mismo
 * alcance y las mismas fuentes que las cifras del Panel. «Trabajos» no viaja desde el navegador: se vuelve a
 * consultar aquí, porque son miles de filas y porque el servidor sí puede certificarlas.
 *
 * Es una acción propia del Panel y no una modificación de `exportBoardDataAction`: esa la comparten los demás
 * tableros y no tienen esta hoja.
 */

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const panelExportSchema = boardDataExportSchema.extend({
  filters: z.object({
    from: z.string().regex(PLAIN_DATE),
    to: z.string().regex(PLAIN_DATE),
    faena: z.string().max(64).nullable().optional(),
    equipo: z.string().max(64).nullable().optional(),
  }),
})

export type PanelExportInput = z.input<typeof panelExportSchema>

/** Tope de filas de la hoja «Trabajos»: sobre eso el período es demasiado ancho para una hoja útil. */
const WORK_SHEET_MAX_ROWS = 20_000

export async function exportPanelBoardAction(input: PanelExportInput): Promise<ExportActionResult> {
  const parsed = panelExportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "El tablero no se pudo exportar: sus datos no son válidos." }

  // «Trabajos» exige `mant:export`, además de cada permiso que declaran las tablas.
  const permissions = [...new Set([...boardExportPermissions(parsed.data), "mant:export" as const])]
  let session
  try {
    for (const permission of permissions) session = await requirePermission(permission)
  } catch {
    return { ok: false, message: "Sin permisos" }
  }
  if (!session) return { ok: false, message: "Sin permisos" }

  try {
    const viewer = viewerFromSession(session)
    const { filters, ...board } = parsed.data
    // Faena y equipo se validan contra el alcance de quien exporta: una faena ajena no devuelve filas.
    const worksiteId = filters.faena || undefined
    const equipment = await resolvePanelEquipment(viewer, worksiteId, filters.equipo || undefined)
    const work = await loadMaintenanceWork(viewer, {
      from: filters.from,
      to: filters.to,
      today: todayInChile(),
      ...(worksiteId ? { worksiteId } : {}),
      ...(equipment ? { vehicleId: equipment.id } : {}),
    })
    const rows = work.rows.slice(0, WORK_SHEET_MAX_ROWS)
    const notes = [
      `Fuente: ${work.includesOrders ? "historial de formularios y órdenes de trabajo no anuladas" : "historial de formularios (este perfil no ve todas las órdenes de trabajo de su alcance)"}; sin filas de prueba.`,
      "«Sin clasificar» = el formulario no indica el tipo de acción. Una celda vacía es un dato que el trabajo no trae, no un cero.",
      ...(work.rows.length > rows.length ? [`La hoja se cortó en ${rows.length} de ${work.rows.length} trabajos: acota el período.`] : []),
    ]
    const base64 = await buildBoardDataWorkbookBase64(session, {
      ...board,
      tables: [
        ...board.tables,
        { permission: "mant:export", title: "Trabajos", headers: [...WORK_SHEET_HEADERS], rows: rows.map(workSheetRow), notes },
      ],
    })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "board_data_export",
      entityId: nanoid(),
      newState: {
        title: board.title,
        scope: board.scope,
        tables: [...board.tables.map((table) => ({ title: table.title, rowCount: table.rows.length })), { title: "Trabajos", rowCount: rows.length }],
        permissions,
      },
    })
    return { ok: true, data: { base64, filename: chartExportFilename(board.title, todayInChile()) } }
  } catch (error) {
    logger.error("[exportPanelBoardAction]", error)
    return { ok: false, message: "No se pudo exportar el tablero. Intenta nuevamente." }
  }
}
