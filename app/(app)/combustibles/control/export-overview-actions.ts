"use server"

import { requirePermission } from "@/lib/auth/can"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { getLitersByMonthAndMedium, getMeterSeries, getWorksiteMediumCrosstab } from "@/lib/combustibles/control/queries/overview"
import {
  EXPORT_FAILURE_PERMISSION,
  LITERS_FORMAT,
  PERFORMANCE_FORMAT,
  addTableSheet,
  filtersFromParams,
  finishExport,
  type ExportParams,
} from "@/lib/combustibles/control/queries/export-xlsx"
import { monthFullLabel, pivotMonthlyByMedium, type Crosstab } from "@/lib/combustibles/control/view-helpers"
import { logger } from "@/lib/logger"

/**
 * Exportaciones de la vista general. Cada acción reconstruye los datos con los
 * mismos filtros de la pantalla (parámetros de la URL), exige
 * `combustibles:export`, y deja la auditoría `export`. No llevan datos personales.
 */

export interface OverviewExportInput {
  params: ExportParams
  /** Solo para la tabla cruzada de una unidad. */
  unit?: PerformanceUnit
}

async function authorize() {
  try {
    return await requirePermission("combustibles:export", "/combustibles/control")
  } catch {
    return null
  }
}

function crosstabSheet(wb: Parameters<typeof addTableSheet>[0], name: string, crosstab: Crosstab) {
  const columns = [
    { header: "Faena", key: "worksite", width: 30 },
    ...crosstab.columns.map((column) => ({ header: `${column.label} (L)`, key: column.key, width: 18, numFmt: LITERS_FORMAT })),
    { header: "Total (L)", key: "_total", width: 16, numFmt: LITERS_FORMAT },
  ]
  const rows = crosstab.rows.map((row) => ({ worksite: row.worksiteName, ...row.cells, _total: row.total }))
  addTableSheet(wb, name, columns, rows, { worksite: "Total", ...crosstab.columnTotals, _total: crosstab.grandTotal })
}

/** G-03 y G-04: litros por faena y medio de los equipos de una unidad. */
export async function exportCrosstabAction(input: OverviewExportInput) {
  const session = await authorize()
  if (!session) return { ok: false as const, message: EXPORT_FAILURE_PERMISSION }
  const unit: PerformanceUnit = input.unit === "liters_per_hour" ? "liters_per_hour" : "km_per_liter"
  const filters = filtersFromParams(input.params)
  try {
    const crosstab = await getWorksiteMediumCrosstab(session, filters, unit)
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    crosstabSheet(wb, `Faena x medio (${PERFORMANCE_UNIT_LABELS[unit].replace("/", "-")})`, crosstab)
    return await finishExport({
      session, wb, filters, rowCount: crosstab.rows.length,
      entityType: "fuel_control_overview_export",
      filename: `control_combustible_faena_medio_${unit === "km_per_liter" ? "km-l" : "l-h"}`,
      extra: { view: "crosstab", unit },
    })
  } catch (error) {
    logger.error("[combustibles/control] exportCrosstabAction falló", error)
    return { ok: false as const, message: "No se pudo generar el archivo. Intenta nuevamente." }
  }
}

/** Toda la vista general en un libro: litros por mes y medio, las dos tablas cruzadas y las dos series. */
export async function exportOverviewAction(input: OverviewExportInput) {
  const session = await authorize()
  if (!session) return { ok: false as const, message: EXPORT_FAILURE_PERMISSION }
  const filters = filtersFromParams(input.params)
  try {
    const [monthly, km, hours, series] = await Promise.all([
      getLitersByMonthAndMedium(session, filters),
      getWorksiteMediumCrosstab(session, filters, "km_per_liter"),
      getWorksiteMediumCrosstab(session, filters, "liters_per_hour"),
      getMeterSeries(session, filters),
    ])
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()

    const pivot = pivotMonthlyByMedium(monthly)
    addTableSheet(
      wb,
      "Litros por mes y medio",
      [
        { header: "Mes", key: "month", width: 12 },
        ...pivot.series.map((item) => ({ header: `${item.label} (L)`, key: item.key, width: 18, numFmt: LITERS_FORMAT })),
        { header: "Total (L)", key: "total", width: 16, numFmt: LITERS_FORMAT },
      ],
      pivot.points.map((point) => ({ ...point, month: monthFullLabel(point.month) })),
    )
    crosstabSheet(wb, "Faena x medio (km-L)", km)
    crosstabSheet(wb, "Faena x medio (L-h)", hours)

    const seriesSheet = (name: string, unit: PerformanceUnit, measureHeader: string, ratioHeader: string) => {
      const data = series[unit]
      addTableSheet(
        wb,
        name,
        [
          { header: "Mes", key: "month", width: 12 },
          { header: measureHeader, key: "measure", width: 18, numFmt: LITERS_FORMAT },
          { header: "Litros de esos tramos (L)", key: "liters", width: 24, numFmt: LITERS_FORMAT },
          { header: ratioHeader, key: "ratio", width: 14, numFmt: PERFORMANCE_FORMAT },
          { header: "Tramos", key: "segments", width: 10 },
        ],
        data.points.map((point) => ({
          month: monthFullLabel(point.month),
          measure: point.measure,
          liters: point.liters,
          ratio: unit === "km_per_liter" ? (point.liters > 0 ? point.measure / point.liters : null) : (point.measure > 0 ? point.liters / point.measure : null),
          segments: point.segments,
        })),
        { month: "Global", measure: data.totalMeasure, liters: data.totalLiters, ratio: data.ratio },
      )
    }
    seriesSheet("Serie km vs litros", "km_per_liter", "Kilómetros recorridos (km)", "km/L")
    seriesSheet("Serie horas vs litros", "liters_per_hour", "Horas de motor (h)", "L/h")

    return await finishExport({
      session, wb, filters, rowCount: monthly.length + km.rows.length + hours.rows.length,
      entityType: "fuel_control_overview_export",
      filename: "control_combustible_vista_general",
      extra: { view: "overview" },
    })
  } catch (error) {
    logger.error("[combustibles/control] exportOverviewAction falló", error)
    return { ok: false as const, message: "No se pudo generar el archivo. Intenta nuevamente." }
  }
}

