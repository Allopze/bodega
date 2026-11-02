import type { OperationalAsset } from "@/lib/services/operational-control"

export interface OperationalExportColumn {
  header: string
  key: string
  width: number
}

/**
 * Columnas de la hoja "Activos" del reporte, condicionadas por capacidad: las
 * superficies derivadas de mantención, inspección o costos no se incluyen
 * cuando el usuario no tiene el permiso del subdominio (no se exportan ceros
 * engañosos en lugar de "sin datos").
 */
export function buildOperationalAssetExportColumns(
  canViewMaintenance: boolean,
  canViewInspections: boolean,
  canViewCosts: boolean,
  canViewFuel = false,
  canViewCapa = false,
  canViewFleet = false,
): OperationalExportColumn[] {
  // El costo de mantención es un dato derivado de las OT: sin `mantenciones:view`
  // la consulta no carga registros y el costo colapsa a 0. Exigir ambos permisos
  // evita exportar "$0" para quien puede ver costos pero no mantenciones.
  const showMaintenanceCost = canViewMaintenance && canViewCosts
  const showFuelCost = canViewFuel && canViewCosts
  const showOperationalCost = showMaintenanceCost && showFuelCost
  const showCapa = canViewCapa && canViewInspections
  return [
    { header: "Contrato", key: "key", width: 34 },
    { header: "Clase", key: "kind", width: 22 },
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
          { header: "Última telemetría", key: "gpsObservedAt", width: 20 },
          { header: "Nivel estanque GPS", key: "gpsFuelLevel", width: 18 },
          { header: "Discrepancia GPS", key: "meterMismatch", width: 18 },
        ]
      : []),
    ...(canViewFuel
      ? [
          { header: "Litros operacionales", key: "fuelLiters", width: 18 },
          { header: "Rendimiento promedio", key: "fuelPerformance", width: 20 },
          { header: "Cargas marcadas (período)", key: "flaggedLoads", width: 18 },
          { header: "Casos abiertos", key: "openAnomalyCases", width: 16 },
          { header: "Motor en vacío (%)", key: "idlePct", width: 16 },
          { header: "Litros en vacío", key: "litersIdle", width: 16 },
        ]
      : []),
    ...(canViewMaintenance
      ? [
          { header: "Mantenciones", key: "maintenance", width: 16 },
          { header: "Backlog", key: "backlog", width: 12 },
          { header: "SLA vencido", key: "openSlaOverdue", width: 14 },
          { header: "Sin responsable", key: "unassignedOpen", width: 16 },
          { header: "Próximo plan", key: "nextPlanDue", width: 16 },
        ]
      : []),
    ...(canViewInspections
      ? [
          { header: "Inspecciones", key: "inspections", width: 16 },
          { header: "Cumplimiento inspecciones", key: "inspectionCompliance", width: 22 },
          { header: "Hallazgos abiertos", key: "openFindings", width: 18 },
          { header: "Hallazgos críticos", key: "criticalOpenFindings", width: 18 },
        ]
      : []),
    ...(showCapa ? [{ header: "CAPA vencidas", key: "overdueCapa", width: 14 }] : []),
    ...(canViewMaintenance ? [{ header: "Downtime (h)", key: "downtime", width: 16 }] : []),
    ...(showFuelCost ? [{ header: "Costo combustible", key: "fuelCost", width: 20 }] : []),
    ...(showMaintenanceCost
      ? [
          { header: "Costo aprobado", key: "approvedCost", width: 20 },
          { header: "Costo comprometido", key: "committedCost", width: 20 },
        ]
      : []),
    ...(showOperationalCost ? [{ header: "Costo operacional total", key: "operationalCost", width: 22 }] : []),
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

export function buildOperationalAssetExportRow(
  asset: OperationalAsset,
  canViewMaintenance: boolean,
  canViewInspections: boolean,
  canViewCosts: boolean,
  canViewFuel = false,
  canViewCapa = false,
  canViewFleet = false,
): Record<string, string | number | null> {
  const showMaintenanceCost = canViewMaintenance && canViewCosts
  const showFuelCost = canViewFuel && canViewCosts
  const showOperationalCost = showMaintenanceCost && showFuelCost
  const showCapa = canViewCapa && canViewInspections
  return {
    key: asset.key,
    kind: asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio",
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
          gpsObservedAt: asset.gpsObservedAt,
          gpsFuelLevel: asset.gpsFuelLevel,
          meterMismatch: asset.meterMismatch ? "Revisar" : null,
        }
      : {}),
    ...(canViewFuel
      ? {
          fuelLiters: asset.fuelLiters,
          fuelPerformance: formatPerformance(asset.fuelPerformanceValue, asset.fuelPerformanceUnit),
          flaggedLoads: asset.flaggedLoads,
          openAnomalyCases: asset.openAnomalyCases,
          idlePct: asset.idlePct,
          litersIdle: asset.litersIdle,
        }
      : {}),
    ...(canViewMaintenance
      ? {
          maintenance: asset.maintenanceCount,
          backlog: asset.openMaintenanceCount,
          openSlaOverdue: asset.openSlaOverdue,
          unassignedOpen: asset.unassignedOpen,
          nextPlanDue: asset.nextPlanDue,
        }
      : {}),
    ...(canViewInspections
      ? {
          inspections: asset.inspectionCount,
          inspectionCompliance: asset.inspectionCompliancePercent,
          openFindings: asset.openFindings,
          criticalOpenFindings: asset.criticalOpenFindings,
        }
      : {}),
    ...(showCapa ? { overdueCapa: asset.overdueCapa } : {}),
    ...(canViewMaintenance ? { downtime: asset.downtimeHours } : {}),
    ...(showFuelCost ? { fuelCost: asset.fuelBilledAmount } : {}),
    ...(showMaintenanceCost
      ? {
          approvedCost: asset.maintenanceCostApproved,
          committedCost: asset.maintenanceCost,
        }
      : {}),
    ...(showOperationalCost
      ? {
          operationalCost: asset.fuelBilledAmount != null && asset.maintenanceCostApproved != null
            ? asset.fuelBilledAmount + asset.maintenanceCostApproved
            : null,
        }
      : {}),
  }
}
