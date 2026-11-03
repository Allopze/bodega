import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { formatDateTime } from "@/lib/utils"

/**
 * Nombres de las faenas del alcance, en el orden de la sesión. Si la lectura
 * falla se cae a los identificadores: la hoja de trazabilidad no puede tumbar
 * la exportación que acompaña.
 */
async function worksiteScopeLabel(session: Session): Promise<string> {
  if (session.user.isGlobal) return "Todas las faenas (usuario global)"
  const ids = session.user.worksiteIds ?? []
  if (ids.length === 0) return "Sin faenas asignadas"
  try {
    const rows = await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, ids))
    const names = new Map(rows.map((row) => [row.id, row.name]))
    return ids.map((id) => names.get(id) ?? id).join(", ")
  } catch {
    return ids.join(", ")
  }
}

/**
 * Añade la hoja de trazabilidad común a todas las exportaciones Excel.
 * Vive fuera de un módulo de negocio para evitar dependencias cruzadas.
 */
export async function addExportMetadataSheet(
  wb: ExcelJS.Workbook,
  session: Session,
  context: {
    filters?: object | null
    rowCount: number
    from?: string | null
    to?: string | null
    /**
     * Salvedades sobre las cifras del libro (p. ej. «sin datos del proveedor en sep-2026»): una fila
     * «Nota» por cada una, al final. Quien lee la hoja de datos por separado pierde la pantalla en que
     * se mostraba el aviso, y esta hoja es lo que viaja con el archivo.
     */
    notes?: readonly string[]
  },
) {
  const scope = await worksiteScopeLabel(session)
  const ws = wb.addWorksheet("Metadatos")
  ws.columns = [{ key: "label", width: 22 }, { key: "value", width: 60 }]
  const entries: Array<[string, string]> = [
    // Hora de Chile y no la del servidor: `toLocaleString` sin zona mostraba UTC en producción.
    ["Generado", `${formatDateTime(new Date())} (hora de Chile)`],
    ["Generado por", session.user.email ?? session.user.name ?? session.user.id],
    ["Alcance de faena", scope],
    ["Filas incluidas", String(context.rowCount)],
    ["Período (desde)", context.from ?? "Sin filtro"],
    ["Período (hasta)", context.to ?? "Sin filtro"],
    ["Filtros aplicados", context.filters ? JSON.stringify(Object.fromEntries(Object.entries(context.filters).filter(([, value]) => value !== undefined))) : "Selección manual de filas"],
  ]
  for (const note of context.notes ?? []) entries.push(["Nota", note])
  for (const [label, value] of entries) ws.addRow({ label, value })
  ws.getColumn("label").font = { bold: true }
}
