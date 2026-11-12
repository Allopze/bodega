import type { OperationalAsset } from "@/lib/services/operational-control"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import { meterSourceLabel } from "@/lib/combustibles/meter-source"

export interface OperationalExportColumn {
  header: string
  key: string
  width: number
}

/**
 * Columnas de la hoja "Activos" del reporte, condicionadas por capacidad: las
 * superficies derivadas de flota, combustible, inspección o costos no se
 * incluyen cuando el usuario no tiene el permiso del subdominio (no se exportan
 * ceros engañosos en lugar de "sin datos").
 *
 * Los flags son posicionales: los nuevos se agregan al final con `false` por
 * defecto, para no romper a los llamadores existentes. `canViewPurchaseCosts`
 * (`purchasing:view`) abre «Repuestos y servicios (OC)», y «Costo total» exige
 * las tres series: combustible, mano de obra de OT y compras.
 */
export function buildOperationalAssetExportColumns(
  canViewInspections: boolean,
  canViewCosts: boolean,
  canViewFuel = false,
  canViewCapa = false,
  canViewFleet = false,
  canViewWorkOrders = false,
  canViewPurchaseCosts = false,
  canViewMaintenance = false,
): OperationalExportColumn[] {
  const showFuelCost = canViewFuel && canViewCosts
  const showCapa = canViewCapa && canViewInspections
  return [
    // Sin «Contrato»: el `key` interno (`vehicle:<uuid>`) no significa nada
    // para quien recibe el archivo. Sin «Clase»: la hoja sólo lleva vehículos,
    // así que la columna valía siempre lo mismo.
    { header: "Código", key: "code", width: 18 },
    { header: "Activo", key: "name", width: 30 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    ...(canViewFleet
      ? [
          { header: "Próximo vencimiento", key: "nextExpiryDate", width: 18 },
          { header: "Documentos vencidos", key: "expiredDocuments", width: 24 },
          { header: "Odómetro GPS", key: "gpsOdometer", width: 16 },
          { header: "Horómetro GPS", key: "gpsHourMeter", width: 16 },
          { header: "Última telemetría", key: "gpsReportedAt", width: 20 },
          { header: "Nivel estanque GPS", key: "gpsFuelLevel", width: 18 },
          { header: "Discrepancia GPS", key: "meterMismatch", width: 18 },
          { header: "Fuente GPS", key: "gpsProviders", width: 18 },
          { header: "Fuente del medidor", key: "gpsMeterProvider", width: 18 },
        ]
      : []),
    ...(canViewFuel
      ? [
          { header: "Rendimiento GPS", key: "gpsPerformance", width: 20 },
          { header: "Fuente del rendimiento", key: "gpsPerformanceSource", width: 20 },
          { header: "Litros operacionales", key: "fuelLiters", width: 18 },
          { header: "Cargas (período)", key: "fuelLoadCount", width: 16 },
          { header: "Última carga", key: "lastFuelLoadAt", width: 20 },
          { header: "Rendimiento promedio", key: "fuelPerformance", width: 20 },
          { header: "Cargas marcadas (período)", key: "flaggedLoads", width: 18 },
          { header: "Casos abiertos", key: "openAnomalyCases", width: 16 },
          { header: "Casos críticos", key: "criticalOpenAnomalyCases", width: 16 },
          { header: "Motor en vacío (%)", key: "idlePct", width: 16 },
          { header: "Litros en vacío", key: "litersIdle", width: 16 },
        ]
      : []),
    ...(canViewInspections
      ? [
          { header: "Inspecciones", key: "inspections", width: 16 },
          { header: "Cumplimiento inspecciones", key: "inspectionCompliance", width: 22 },
          { header: "Hallazgos abiertos", key: "openFindings", width: 18 },
          { header: "Hallazgos críticos", key: "criticalOpenFindings", width: 18 },
          { header: "Hallazgos con OT", key: "openFindingsWithWorkOrder", width: 18 },
          { header: "Hallazgos sin OT", key: "openFindingsWithoutWorkOrder", width: 18 },
        ]
      : []),
    ...(showCapa ? [{ header: "CAPA vencidas", key: "overdueCapa", width: 14 }] : []),
    ...(canViewWorkOrders
      ? [
          { header: "OT abiertas", key: "openWorkOrders", width: 14 },
          { header: "En taller", key: "inWorkshop", width: 12 },
          { header: "Horas en taller (período)", key: "workshopHours", width: 22 },
          { header: "Mano de obra / taller (OT)", key: "maintenanceCost", width: 24 },
        ]
      : []),
    ...(canViewPurchaseCosts ? [{ header: "Repuestos y servicios (OC)", key: "purchaseAmount", width: 26 }] : []),
    ...(canViewMaintenance ? [{ header: "Estimación GPS de mantención", key: "gpsMaintenance", width: 22 }] : []),
    ...(showFuelCost && canViewPurchaseCosts && canViewWorkOrders
      ? [{ header: "Costo por km/h (GPS)", key: "gpsCostPerUnit", width: 20 }]
      : []),
    ...(showFuelCost ? [{ header: "Costo combustible (proveedor)", key: "fuelCost", width: 24 }] : []),
    ...(showFuelCost && canViewWorkOrders && canViewPurchaseCosts
      ? [{ header: "Costo total (combustible + mano de obra + compras)", key: "totalCost", width: 36 }]
      : []),
  ]
}

/**
 * Fila de un activo para la hoja "Activos". El estado se exporta con la
 * etiqueta humana (`operationalStatusLabel`), nunca el enum crudo (regla A6),
 * y las claves coinciden exactamente con las columnas devueltas por
 * `buildOperationalAssetExportColumns`.
 */
function formatPerformance(
  value: number | null,
  unit: OperationalAsset["fuelPerformanceUnit"],
): string | null {
  if (value == null || unit == null) return null
  const formatted = value.toLocaleString("es-CL", { maximumFractionDigits: 2 })
  return `${formatted} ${unit === "km_per_liter" ? "km/L" : "L/h"}`
}

function providerName(provider: string): string {
  return provider === "onway" ? "OnWay" : provider === "wialon" ? "Wialon" : provider
}

export function buildOperationalAssetExportRow(
  asset: OperationalAsset,
  canViewInspections: boolean,
  canViewCosts: boolean,
  canViewFuel = false,
  canViewCapa = false,
  canViewFleet = false,
  canViewWorkOrders = false,
  canViewPurchaseCosts = false,
  canViewMaintenance = false,
): Record<string, string | number | null> {
  const showFuelCost = canViewFuel && canViewCosts
  const showCapa = canViewCapa && canViewInspections
  return {
    code: asset.code,
    name: asset.name,
    worksite: asset.worksiteName,
    status: asset.operationalStatusLabel,
    ...(canViewFleet
      ? {
          nextExpiryDate: asset.nextExpiryDate,
          expiredDocuments: asset.expiredDocumentTypes.length > 0 ? asset.expiredDocumentTypes.join(", ") : null,
          gpsOdometer: asset.gpsOdometer,
          gpsHourMeter: asset.gpsHourMeter,
          gpsReportedAt: asset.gpsReportedAt,
          gpsFuelLevel: asset.gpsFuelLevel,
          meterMismatch: asset.meterMismatch ? "Revisar" : null,
          gpsProviders: asset.gpsProviders.length > 0 ? asset.gpsProviders.map(providerName).join(" + ") : null,
          gpsMeterProvider: asset.gpsMeterProvider ? providerName(asset.gpsMeterProvider) : null,
        }
      : {}),
    ...(canViewFuel
      ? {
          gpsPerformance: formatPerformance(asset.gpsPerformanceValue, asset.gpsPerformanceUnit),
          gpsPerformanceSource: meterSourceLabel(asset.gpsMeterSource),
          fuelLiters: asset.fuelLiters,
          fuelLoadCount: asset.fuelLoadCount,
          lastFuelLoadAt: asset.lastFuelLoadAt,
          fuelPerformance: formatPerformance(asset.fuelPerformanceValue, asset.fuelPerformanceUnit),
          flaggedLoads: asset.flaggedLoads,
          openAnomalyCases: asset.openAnomalyCases,
          criticalOpenAnomalyCases: asset.criticalOpenAnomalyCases,
          idlePct: asset.idlePct,
          litersIdle: asset.litersIdle,
        }
      : {}),
    ...(canViewInspections
      ? {
          inspections: asset.inspectionCount,
          inspectionCompliance: asset.inspectionCompliancePercent,
          openFindings: asset.openFindings,
          criticalOpenFindings: asset.criticalOpenFindings,
          openFindingsWithWorkOrder: asset.openFindingsWithWorkOrder,
          openFindingsWithoutWorkOrder: asset.openFindingsWithoutWorkOrder,
        }
      : {}),
    ...(showCapa ? { overdueCapa: asset.overdueCapa } : {}),
    ...(canViewWorkOrders
      ? {
          openWorkOrders: asset.openWorkOrders,
          inWorkshop: asset.inWorkshop == null ? null : asset.inWorkshop ? "Sí" : "No",
          workshopHours: asset.workshopHours == null ? null : Math.round(asset.workshopHours * 10) / 10,
          maintenanceCost: asset.maintenanceCost,
        }
      : {}),
    ...(canViewPurchaseCosts ? { purchaseAmount: asset.purchaseAmount } : {}),
    ...(canViewMaintenance
      ? { gpsMaintenance: asset.gpsMaintenanceState ? EQUIPMENT_STATE_LABEL[asset.gpsMaintenanceState] : null }
      : {}),
    ...(showFuelCost && canViewPurchaseCosts && canViewWorkOrders ? { gpsCostPerUnit: asset.gpsCostPerUnit } : {}),
    ...(showFuelCost ? { fuelCost: asset.fuelBilledAmount } : {}),
    ...(showFuelCost && canViewWorkOrders && canViewPurchaseCosts ? { totalCost: asset.totalCost } : {}),
  }
}
