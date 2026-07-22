import ExcelJS from "exceljs"
import type { Session } from "next-auth"

/**
 * Añade la hoja de trazabilidad común a todas las exportaciones Excel.
 * Vive fuera de un módulo de negocio para evitar dependencias cruzadas.
 */
export function addExportMetadataSheet(
  wb: ExcelJS.Workbook,
  session: Session,
  context: { filters?: object | null; rowCount: number; from?: string | null; to?: string | null },
) {
  const ws = wb.addWorksheet("Metadatos")
  ws.columns = [{ key: "label", width: 22 }, { key: "value", width: 60 }]
  const entries: Array<[string, string]> = [
    ["Generado", new Date().toLocaleString("es-CL")],
    ["Generado por", session.user.email ?? session.user.name ?? session.user.id],
    ["Alcance de faena", session.user.isGlobal ? "Todas las faenas (usuario global)" : (session.user.worksiteIds ?? []).join(", ") || "Sin faenas asignadas"],
    ["Filas incluidas", String(context.rowCount)],
    ["Período (desde)", context.from ?? "Sin filtro"],
    ["Período (hasta)", context.to ?? "Sin filtro"],
    ["Filtros aplicados", context.filters ? JSON.stringify(Object.fromEntries(Object.entries(context.filters).filter(([, value]) => value !== undefined))) : "Selección manual de filas"],
  ]
  for (const [label, value] of entries) ws.addRow({ label, value })
  ws.getColumn("label").font = { bold: true }
}
