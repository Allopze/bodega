"use server"

import { safeActionMessage } from "@/lib/action-error"

import { requireAnyPermission } from "@/lib/auth/can"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { getOperationalControlHub, resolveOperationalControlPeriod, type OperationalControlPeriod } from "@/lib/services/operational-control"
import { OPERATIONAL_CONTROL_VIEW_PERMISSIONS } from "@/lib/operational-control/capabilities"
import { buildOperationalAssetExportColumns, buildOperationalAssetExportRow } from "@/lib/operational-control/export-columns"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

export async function exportOperationalControlXlsxAction(filters: Partial<OperationalControlPeriod>) {
  let session
  try { session = await requireAnyPermission(OPERATIONAL_CONTROL_VIEW_PERMISSIONS, "/control-operacional") }
  catch { return { ok: false as const, message: "Sin permisos para exportar Control operacional" } }
  try {
    const period = resolveOperationalControlPeriod(filters)
    // El Excel lleva activos e indicadores; los conteos de «Requiere atención» son del panel.
    const data = await getOperationalControlHub(session, period, { includeAttention: false })
    const { canViewFleet, canViewInspections, canViewCapa, canViewFuel, canViewCosts, canViewWorkOrders, canViewPurchaseCosts } = data.permissions
    const showFuelCost = canViewFuel && canViewCosts
    // Los instrumentos de servicio no tienen combustible modelado; no se
    // exportan como activos operacionales para no pintar filas inertes.
    const operationalAssets = data.assets.filter((asset) => asset.kind === "vehicle")
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Activos")
    sheet.columns = buildOperationalAssetExportColumns(canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet, canViewWorkOrders, canViewPurchaseCosts)
    for (const asset of operationalAssets) {
      sheet.addRow(buildOperationalAssetExportRow(asset, canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet, canViewWorkOrders, canViewPurchaseCosts))
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    // Las cuatro cifras en pesos del grupo de costos llevan el mismo formato; cada
    // columna sólo existe con la capacidad de su serie (ver `buildOperationalAssetExportColumns`).
    if (showFuelCost) sheet.getColumn("fuelCost").numFmt = "$#,##0"
    if (canViewWorkOrders) sheet.getColumn("maintenanceCost").numFmt = "$#,##0"
    if (canViewPurchaseCosts) sheet.getColumn("purchaseAmount").numFmt = "$#,##0"
    if (showFuelCost && canViewWorkOrders && canViewPurchaseCosts) sheet.getColumn("totalCost").numFmt = "$#,##0"
    if (canViewInspections) sheet.getColumn("inspectionCompliance").numFmt = '0.0"%"'

    // Mismos decimales que la pantalla: un float crudo en el Excel se copia
    // tal cual a un correo y contradice la cifra que se vio al exportar.
    const round1 = (value: number | null) => value == null ? null : Math.round(value * 10) / 10
    const indicatorRows: (string | number | null)[][] = [
      ["Período", `${period.from} a ${period.to}`],
      ["Disponibilidad (%)", round1(data.metrics.availabilityPercent)],
      ["Cobertura de estado (%)", round1(data.metrics.stateCoveragePercent)],
    ]
    // Si la consulta de una fuente falló, sus campos vienen `null` en todos los
    // activos: sumar con `?? 0` publicaba un 0 que se lee como «no hubo». En
    // ese caso la cifra del Excel va vacía, igual que en la pantalla.
    const sumIfPresent = (pick: (asset: (typeof operationalAssets)[number]) => number | null) =>
      operationalAssets.some((asset) => pick(asset) != null)
        ? operationalAssets.reduce((sum, asset) => sum + (pick(asset) ?? 0), 0)
        : null
    if (canViewFuel) {
      indicatorRows.push(["Litros operacionales", sumIfPresent((asset) => asset.fuelLiters)])
    }
    if (showFuelCost) {
      indicatorRows.push(["Costo combustible (proveedor)", sumIfPresent((asset) => asset.fuelBilledAmount)])
    }
    if (canViewPurchaseCosts) {
      // Líneas de OC de solicitudes vinculadas a un equipo, emitidas en el período.
      indicatorRows.push(["Compras vinculadas a equipos", sumIfPresent((asset) => asset.purchaseAmount)])
    }
    if (canViewInspections) {
      indicatorRows.push(
        ["Hallazgos abiertos", sumIfPresent((asset) => asset.openFindings)],
        ["Hallazgos críticos", sumIfPresent((asset) => asset.criticalOpenFindings)],
      )
    }
    if (canViewWorkOrders) {
      indicatorRows.push(
        // Sin ninguna cifra por equipo (la consulta de OT falló) no es un 0: va vacío.
        ["OT abiertas", operationalAssets.some((asset) => asset.openWorkOrders != null)
          ? operationalAssets.reduce((sum, asset) => sum + (asset.openWorkOrders ?? 0), 0)
          : null],
        // La pantalla muestra horas enteras (`formatKpi(..., 0)`): el Excel no
        // puede publicar un decimal que la tira de desempeño no muestra.
        ["Horas en taller (período)", data.metrics.workshopHours == null ? null : Math.round(data.metrics.workshopHours)],
        ["Tiempo medio de reparación (h)", data.metrics.mttrHours == null ? null : Math.round(data.metrics.mttrHours * 10) / 10],
      )
    }
    if (canViewInspections && canViewCapa) {
      indicatorRows.push(["CAPA vencidas", sumIfPresent((asset) => asset.overdueCapa)])
    }
    if (data.degradedSources.length > 0) {
      indicatorRows.push(["Secciones no cargadas", data.degradedSources.join(", ")])
    }
    const indicators = workbook.addWorksheet("Indicadores")
    indicators.addRows(indicatorRows)
    indicators.getColumn(1).width = 32
    indicators.getColumn(2).width = 22
    indicators.getRow(1).font = { bold: true }

    await addExportMetadataSheet(workbook, session, { filters: period, rowCount: operationalAssets.length })
    const base64 = await xlsxToBase64(workbook)
    await recordAudit({ userId: session.user.id, action: "export", entityType: "operational_control_report", entityId: nanoid(), newState: { period, rowCount: operationalAssets.length, includesFuelCosts: showFuelCost, includesPurchaseCosts: canViewPurchaseCosts, includesCapa: canViewInspections && canViewCapa } })
    return { ok: true as const, data: { base64, filename: `control_operacional_${period.from}_${period.to}.xlsx` } }
  } catch (error) { return { ok: false as const, message: safeActionMessage(error, "No se pudo exportar el reporte") } }
}
