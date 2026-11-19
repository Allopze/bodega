"use server"

import { safeActionMessage } from "@/lib/action-error"

import { requireAnyPermission } from "@/lib/auth/can"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { getOperationalControlHub, resolveOperationalControlPeriod, type OperationalControlPeriod } from "@/lib/services/operational-control"
import { OPERATIONAL_CONTROL_VIEW_PERMISSIONS } from "@/lib/operational-control/capabilities"
import { buildOperationalAssetExportColumns, buildOperationalAssetExportRow } from "@/lib/operational-control/export-columns"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { contractVehicleIds, getContractCostBreakdown, type ContractCostBreakdown } from "@/lib/services/contracts/contract-costs"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

/** Hoja «Costo por contrato»: las mismas filas que la sección del Panel, con los importes en pesos. */
function addContractCostSheet(workbook: import("exceljs").Workbook, breakdown: ContractCostBreakdown) {
  const sheet = workbook.addWorksheet("Costo por contrato")
  sheet.columns = [
    { header: "Faena", key: "worksite", width: 28 },
    { header: "Contrato", key: "contract", width: 32 },
    { header: "Mandante", key: "client", width: 28 },
    { header: "Equipos", key: "vehicles", width: 10 },
    { header: "Combustible", key: "fuel", width: 16 },
    { header: "Compras", key: "purchases", width: 16 },
    { header: "Total", key: "total", width: 16 },
    { header: "Parcial", key: "partial", width: 10 },
  ]
  for (const worksite of breakdown.worksites) {
    for (const row of worksite.rows) {
      sheet.addRow({
        worksite: worksite.worksiteName,
        contract: row.label,
        client: row.clientName,
        // Las filas de «Por repartir» y «Compras sin equipo» no cuentan equipos.
        vehicles: row.kind === "pending" || row.kind === "no_equipment" ? null : row.vehicleCount,
        fuel: row.fuel,
        purchases: row.purchases,
        total: row.total,
        partial: row.partial ? "Sí" : "No",
      })
    }
  }
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  for (const key of ["fuel", "purchases", "total"]) sheet.getColumn(key).numFmt = "$#,##0"
}

export async function exportOperationalControlXlsxAction(filters: Partial<OperationalControlPeriod> & { contrato?: string }) {
  let session
  try { session = await requireAnyPermission(OPERATIONAL_CONTROL_VIEW_PERMISSIONS, "/control-operacional") }
  catch { return { ok: false as const, message: "Sin permisos para exportar Control operacional" } }
  try {
    const period = resolveOperationalControlPeriod(filters)
    // El Excel lleva activos e indicadores; los conteos de «Requiere atención» son del panel.
    const data = await getOperationalControlHub(session, period, { includeAttention: false })
    const { canViewFleet, canViewInspections, canViewCapa, canViewFuel, canViewCosts, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance } = data.permissions
    const showFuelCost = canViewFuel && canViewCosts
    // Los instrumentos de servicio no tienen combustible modelado; no se
    // exportan como activos operacionales para no pintar filas inertes.
    const operationalAssets = data.assets.filter((asset) => asset.kind === "vehicle")
    // Costo por contrato: una consulta agrupada con los vehículos del hub. Si falla, el Excel sigue
    // sin esa hoja y lo dice en «Secciones no cargadas», igual que las demás fuentes.
    const degradedSources = [...data.degradedSources]
    let contractCosts: ContractCostBreakdown | null = null
    try {
      contractCosts = await getContractCostBreakdown(session, period, operationalAssets.map((asset) => ({ id: asset.id, worksiteId: asset.worksiteId })))
    } catch (error) {
      logger.warn("[control-operacional] no se pudo calcular el costo por contrato para el Excel", error)
      degradedSources.push("costo por contrato")
    }
    // «Activos» se filtra como la pantalla; un contrato fuera del alcance no filtra nada.
    const selectedContractId = contractCosts && filters.contrato && contractCosts.contractOptions.some((option) => option.id === filters.contrato)
      ? filters.contrato
      : null
    const contractVehicles = contractCosts && selectedContractId ? contractVehicleIds(contractCosts.windows, selectedContractId, period) : null
    const exportedAssets = contractVehicles ? operationalAssets.filter((asset) => contractVehicles.has(asset.id)) : operationalAssets
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Activos")
    sheet.columns = buildOperationalAssetExportColumns(canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance)
    for (const asset of exportedAssets) {
      sheet.addRow(buildOperationalAssetExportRow(asset, canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance))
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    // Las cifras en pesos del grupo de costos llevan el mismo formato; cada
    // columna sólo existe con la capacidad de su serie (ver `buildOperationalAssetExportColumns`).
    if (showFuelCost) sheet.getColumn("fuelCost").numFmt = "$#,##0"
    if (canViewPurchaseCosts) sheet.getColumn("purchaseAmount").numFmt = "$#,##0"
    if (showFuelCost && canViewPurchaseCosts) sheet.getColumn("totalCost").numFmt = "$#,##0"
    if (showFuelCost && canViewPurchaseCosts) sheet.getColumn("gpsCostPerUnit").numFmt = "$#,##0"
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
    if (canViewFleet) {
      indicatorRows.push(
        ["Equipos con reporte GPS (24 h)", `${data.gpsCross.reporting24h} de ${data.gpsCross.totalVehicles}`],
        ["Discrepancias de medidor GPS", data.gpsCross.meterMismatches],
      )
    }
    if (canViewFleet && canViewMaintenance) {
      indicatorRows.push(["Mantención vencida según GPS", data.gpsCross.maintenance.overdue])
    }
    if (canViewCapa && canViewInspections) {
      indicatorRows.push(["CAPA vencidas con equipo operando (GPS)", data.gpsCross.prevention.operatingWithOverdueCapa])
    }
    if (degradedSources.length > 0) {
      indicatorRows.push(["Secciones no cargadas", degradedSources.join(", ")])
    }
    const indicators = workbook.addWorksheet("Indicadores")
    indicators.addRows(indicatorRows)
    indicators.getColumn(1).width = 32
    indicators.getColumn(2).width = 22
    indicators.getRow(1).font = { bold: true }

    // Sin ningún componente de costo disponible la hoja sería sólo «—»: igual que la sección, no se agrega.
    if (contractCosts && contractCosts.worksites.length > 0 && Object.values(contractCosts.availability).some(Boolean)) {
      addContractCostSheet(workbook, contractCosts)
    }

    await addExportMetadataSheet(workbook, session, { filters: { ...period, ...(selectedContractId ? { contrato: selectedContractId } : {}) }, rowCount: exportedAssets.length })
    const base64 = await xlsxToBase64(workbook)
    await recordAudit({ userId: session.user.id, action: "export", entityType: "operational_control_report", entityId: nanoid(), newState: { period, contractId: selectedContractId, rowCount: exportedAssets.length, includesContractCosts: contractCosts !== null, includesFuelCosts: showFuelCost, includesPurchaseCosts: canViewPurchaseCosts, includesCapa: canViewInspections && canViewCapa } })
    return { ok: true as const, data: { base64, filename: `control_operacional_${period.from}_${period.to}.xlsx` } }
  } catch (error) { return { ok: false as const, message: safeActionMessage(error, "No se pudo exportar el reporte") } }
}
