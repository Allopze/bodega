import type { Session } from "next-auth"
import { z } from "zod"
import type { Permission } from "@/modules/permissions"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell } from "@/lib/reports/export-module/types"

/**
 * Exportación a Excel de «Ver datos» (Fase 4 de `AUDITORIA_VISUALIZACIONES_CHOME.md`): la tabla
 * que acompaña a cada gráfico se descarga como `.xlsx`, con las mismas filas que se ven.
 *
 * Es un **contrato** y un constructor, sin acceso a datos: lo que se exporta es lo que el
 * navegador ya muestra. El servidor no recalcula nada (no hay nada que recalcular: una tabla de
 * gráfico es el resultado de consultas muy distintas), por eso:
 *
 * - **Se guarda con el permiso de exportar del módulo**, no con el de ver. Que alguien vea una
 *   cifra no le da la descarga: cada módulo separa `*:export` de `*:view` (`combustibles:export`,
 *   `analytics:export`, `billing:export`…). El permiso lo declara quien dibuja el gráfico y la acción
 *   lo exige con `requirePermission`; sólo valen los de esta lista, que son los de exportación
 *   *general* de cada módulo (no `combustibles:export_sensitive` ni los de datos personales).
 * - **El libro dice que es una copia de la pantalla**: la hoja «Metadatos» (quién, cuándo, alcance de
 *   faena) lleva una nota con eso, porque el contenido lo trajo el navegador y el servidor no lo
 *   puede certificar. También viaja ahí el aviso de cobertura del gráfico (`notes`), que se pierde
 *   si sólo se lee la hoja de datos.
 * - **Tamaño acotado** en el borde: una tabla de gráfico son decenas de filas; el tope existe para
 *   que la acción no sirva de conversor de archivos arbitrarios.
 */
export const CHART_EXPORT_PERMISSIONS = [
  "analytics:export",
  "billing:export",
  "combustibles:export",
  "combustibles:tae_export",
  "mant:export",
  "prevention:incidents:export",
  "prevention:inspections:export",
  "prevention:legal:export",
  "prevention:permits:export",
  "prevention:training:export",
  "ti:export",
] as const satisfies readonly Permission[]

export type ChartExportPermission = (typeof CHART_EXPORT_PERMISSIONS)[number]

export const CHART_EXPORT_LIMITS = {
  title: 120,
  columns: 40,
  rows: 2000,
  cell: 500,
  notes: 6,
  note: 600,
} as const

const cell = z.union([z.string().max(CHART_EXPORT_LIMITS.cell), z.number(), z.null()])

export const chartDataExportSchema = z.object({
  permission: z.enum(CHART_EXPORT_PERMISSIONS),
  title: z.string().trim().min(1).max(CHART_EXPORT_LIMITS.title),
  headers: z.array(z.string().max(CHART_EXPORT_LIMITS.cell)).min(1).max(CHART_EXPORT_LIMITS.columns),
  rows: z.array(z.array(cell).max(CHART_EXPORT_LIMITS.columns)).max(CHART_EXPORT_LIMITS.rows),
  notes: z.array(z.string().max(CHART_EXPORT_LIMITS.note)).max(CHART_EXPORT_LIMITS.notes).optional(),
})

export type ChartDataExportInput = z.input<typeof chartDataExportSchema>

/**
 * `litros_por_mes_2026-11-03.xlsx`: el título del gráfico, en minúsculas y sin tildes ni signos, y el día
 * (hora de Chile, quien llama lo resuelve con `todayInChile()`), como el resto de las exportaciones.
 */
export function chartExportFilename(title: string, today: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "")
  return `${slug || "grafico"}_${today}.xlsx`
}

/** La nota que viaja en «Metadatos»: la tabla es lo que mostraba la pantalla, no un recálculo del servidor. */
export const chartExportScreenNote = (title: string) =>
  `Copia de la tabla «Ver datos» de «${title}», tal como se mostraba en pantalla al exportar; el servidor no la recalcula.`

/** Las filas del libro: cada fila con el largo de los encabezados (la que sobra se corta, la que falta se completa). */
function squareRows(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<ReportCell>>): ReportCell[][] {
  return rows.map((row) => headers.map((_, index) => row[index] ?? null))
}

/** Arma el libro: una hoja con la tabla (encabezado en negrita, fila congelada, filtros) y «Metadatos». Devuelve base64. */
export async function buildChartDataWorkbookBase64(
  session: Session,
  input: z.output<typeof chartDataExportSchema>,
): Promise<string> {
  const buffer = await buildXlsxBuffer(
    {
      filenameBase: input.title,
      worksheetName: input.title,
      headers: input.headers,
      rows: squareRows(input.headers, input.rows),
    },
    {
      session,
      filters: { tabla: input.title },
      notes: [chartExportScreenNote(input.title), ...(input.notes ?? [])],
    },
  )
  return Buffer.from(buffer).toString("base64")
}
