"use server"

import { requirePermission, can } from "@/lib/auth/can"
import {
  LOAD_SOURCE_LABELS,
  PERFORMANCE_FAMILY_LABELS,
  PERFORMANCE_STATUS_LABELS,
  PERFORMANCE_UNIT_LABELS,
  REVIEW_STATUS_LABELS,
  familyFromSlug,
  type LoadSource,
  type PerformanceStatus,
  type ReviewStatus,
} from "@/lib/combustibles/control/contracts"
import { EXPORT_ROW_LIMIT, getEquipmentStats, getWorksiteStats } from "@/lib/combustibles/control/queries/performance"
import { getLoadDetail } from "@/lib/combustibles/control/queries/performance-detail"
import {
  EXPORT_FAILURE_PERMISSION,
  LITERS_FORMAT,
  PERFORMANCE_FORMAT,
  addTableSheet,
  filtersFromParams,
  finishExport,
  type ExportParams,
} from "@/lib/combustibles/control/queries/export-xlsx"
import { CV_ALERT_THRESHOLD } from "@/lib/combustibles/control/view-helpers"
import { logger } from "@/lib/logger"
import { formatDateTime } from "@/lib/utils"

/**
 * Exportaciones de las vistas de rendimiento por familia. La familia viene del
 * segmento de la URL (`familia`), nunca de los parámetros: no se puede pedir
 * una familia distinta a la de la pantalla. Cada acción reconstruye los datos
 * con los filtros de la URL, exige `combustibles:export` y audita la descarga.
 * La columna de supervisor solo sale con `combustibles:view_personal`.
 */

export interface FamilyExportInput {
  familia: string
  params: ExportParams
}

async function prepare(input: FamilyExportInput) {
  let session
  try {
    session = await requirePermission("combustibles:export", "/combustibles/control")
  } catch {
    return { error: EXPORT_FAILURE_PERMISSION } as const
  }
  const family = familyFromSlug(String(input.familia))
  if (!family) return { error: "Familia de equipos desconocida" } as const
  return { session, family, filters: filtersFromParams(input.params, family) } as const
}

const FAILURE = { ok: false as const, message: "No se pudo generar el archivo. Intenta nuevamente." }

/** R-02: promedio, desviación muestral y dispersión por faena y unidad. */
export async function exportWorksiteStatsAction(input: FamilyExportInput) {
  const ctx = await prepare(input)
  if ("error" in ctx) return { ok: false as const, message: ctx.error }
  try {
    const rows = await getWorksiteStats(ctx.session, ctx.filters)
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    addTableSheet(
      wb,
      "Rendimiento por faena",
      [
        { header: "Faena", key: "worksite", width: 30 },
        { header: "Unidad", key: "unit", width: 10 },
        { header: "Cargas válidas", key: "n", width: 14 },
        { header: "Promedio", key: "mean", width: 12, numFmt: PERFORMANCE_FORMAT },
        { header: "Desviación estándar muestral", key: "sd", width: 28, numFmt: PERFORMANCE_FORMAT },
        { header: "Coeficiente de variación", key: "cv", width: 24, numFmt: "0.0%" },
        { header: "Dispersión", key: "dispersion", width: 40 },
      ],
      rows.map((row) => ({
        worksite: row.worksiteName,
        unit: PERFORMANCE_UNIT_LABELS[row.unit],
        n: row.n,
        mean: row.mean,
        sd: row.sd,
        cv: row.cv,
        dispersion: row.cv === null ? "Sin cálculo (menos de 2 cargas)" : row.cv > CV_ALERT_THRESHOLD ? "Alta: sobre 25 % del promedio" : "Dentro de lo esperado",
      })),
    )
    return await finishExport({
      session: ctx.session, wb, filters: ctx.filters, rowCount: rows.length,
      entityType: "fuel_control_performance_export",
      filename: `rendimiento_${input.familia}_por_faena`,
      extra: { view: "worksite", family: ctx.family },
    })
  } catch (error) {
    logger.error("[combustibles/control] exportWorksiteStatsAction falló", error)
    return FAILURE
  }
}

/** R-03 y R-06: una fila por equipo, con comparación contra su modelo y su histórico. */
export async function exportEquipmentStatsAction(input: FamilyExportInput) {
  const ctx = await prepare(input)
  if ("error" in ctx) return { ok: false as const, message: ctx.error }
  try {
    const { rows, pagination } = await getEquipmentStats(ctx.session, ctx.filters, { all: true })
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    addTableSheet(
      wb,
      "Rendimiento por equipo",
      [
        { header: "Faena asignada", key: "worksite", width: 26 },
        { header: "Código", key: "code", width: 12 },
        { header: "Patente", key: "plate", width: 12 },
        { header: "Marca", key: "brand", width: 14 },
        { header: "Modelo", key: "model", width: 14 },
        { header: "Tipo de equipo", key: "type", width: 20 },
        { header: "Unidad", key: "unit", width: 10 },
        { header: "Cargas válidas", key: "n", width: 14 },
        { header: "Promedio", key: "mean", width: 12, numFmt: PERFORMANCE_FORMAT },
        { header: "Desviación estándar muestral", key: "sd", width: 28, numFmt: PERFORMANCE_FORMAT },
        { header: "Promedio del modelo", key: "modelMean", width: 20, numFmt: PERFORMANCE_FORMAT },
        { header: "Δ vs modelo (%)", key: "deltaModel", width: 16, numFmt: PERFORMANCE_FORMAT },
        { header: "Su histórico (12 meses previos)", key: "historyMean", width: 28, numFmt: PERFORMANCE_FORMAT },
        { header: "Δ vs histórico (%)", key: "deltaHistory", width: 18, numFmt: PERFORMANCE_FORMAT },
        { header: "Rinde peor", key: "worse", width: 22 },
      ],
      rows.map((row) => ({
        worksite: row.worksiteName,
        code: row.code,
        plate: row.plate,
        brand: row.brand,
        model: row.model,
        type: row.equipmentType,
        unit: PERFORMANCE_UNIT_LABELS[row.unit],
        n: row.n,
        mean: row.mean,
        sd: row.sd,
        modelMean: row.modelMean,
        deltaModel: row.deltaModelPct,
        historyMean: row.historyMean,
        deltaHistory: row.deltaHistoryPct,
        worse: [row.worseThanModel ? "vs modelo" : null, row.worseThanHistory ? "vs histórico" : null].filter(Boolean).join(" y ") || "",
      })),
    )
    return await finishExport({
      session: ctx.session, wb, filters: ctx.filters, rowCount: rows.length,
      entityType: "fuel_control_performance_export",
      filename: `rendimiento_${input.familia}_por_equipo`,
      extra: { view: "equipment", family: ctx.family },
      truncated: pagination.totalItems > EXPORT_ROW_LIMIT,
      rowLimit: EXPORT_ROW_LIMIT,
    })
  } catch (error) {
    logger.error("[combustibles/control] exportEquipmentStatsAction falló", error)
    return FAILURE
  }
}

/** R-05: detalle de cargas de la familia. */
export async function exportLoadDetailAction(input: FamilyExportInput) {
  const ctx = await prepare(input)
  if ("error" in ctx) return { ok: false as const, message: ctx.error }
  const includePersonal = can(ctx.session, "combustibles:view_personal")
  try {
    const { rows, pagination } = await getLoadDetail(ctx.session, ctx.filters, { includePersonal, all: true })
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    const columns = [
      { header: "Fecha y hora", key: "at", width: 18 },
      { header: "Faena", key: "worksite", width: 26 },
      { header: "Código", key: "code", width: 12 },
      { header: "Patente", key: "plate", width: 12 },
      { header: "Medidor", key: "meterType", width: 12 },
      { header: "Lectura del medidor", key: "reading", width: 18, numFmt: "#,##0.0" },
      { header: "Rendimiento calculado", key: "performance", width: 20, numFmt: PERFORMANCE_FORMAT },
      { header: "Unidad", key: "unit", width: 10 },
      { header: "Estado del cálculo", key: "status", width: 32 },
      { header: "Declarado en planilla", key: "declared", width: 20, numFmt: PERFORMANCE_FORMAT },
      { header: "Litros", key: "liters", width: 12, numFmt: LITERS_FORMAT },
      { header: "Medio de suministro", key: "medium", width: 18 },
      ...(includePersonal ? [{ header: "Supervisor", key: "supervisor", width: 24 }] : []),
      { header: "Revisión", key: "review", width: 18 },
      { header: "Origen", key: "source", width: 22 },
    ]
    addTableSheet(
      wb,
      "Detalle de cargas",
      columns,
      rows.map((row) => ({
        at: formatDateTime(row.occurredAt),
        worksite: row.worksiteName,
        code: row.code,
        plate: row.plate,
        meterType: row.meterType === "hour_meter" ? "Horómetro (h)" : row.meterType === "odometer" ? "Odómetro (km)" : "",
        reading: row.meterReading,
        performance: row.performanceStatus === "computed" ? row.performanceValue : null,
        unit: row.unit ? PERFORMANCE_UNIT_LABELS[row.unit] : "",
        status: PERFORMANCE_STATUS_LABELS[row.performanceStatus as PerformanceStatus] ?? row.performanceStatus,
        declared: row.declaredPerformance,
        liters: row.liters,
        medium: row.mediumName ?? "Sin medio informado",
        supervisor: row.supervisor,
        review: REVIEW_STATUS_LABELS[row.reviewStatus as ReviewStatus] ?? row.reviewStatus,
        source: LOAD_SOURCE_LABELS[row.source as LoadSource] ?? row.source,
      })),
    )
    return await finishExport({
      session: ctx.session, wb, filters: ctx.filters, rowCount: rows.length,
      entityType: "fuel_control_performance_export",
      filename: `rendimiento_${input.familia}_cargas`,
      extra: { view: "loads", family: ctx.family, familyLabel: PERFORMANCE_FAMILY_LABELS[ctx.family], includesPersonal: includePersonal },
      truncated: pagination.totalItems > EXPORT_ROW_LIMIT,
      rowLimit: EXPORT_ROW_LIMIT,
    })
  } catch (error) {
    logger.error("[combustibles/control] exportLoadDetailAction falló", error)
    return FAILURE
  }
}
