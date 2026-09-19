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
): OperationalExportColumn[] {
  // El costo de mantención es un dato derivado de las OT: sin `mantenciones:view`
  // la consulta no carga registros y el costo colapsa a 0. Exigir ambos permisos
  // evita exportar "$0" para quien puede ver costos pero no mantenciones.
  const showCost = canViewMaintenance && canViewCosts
  return [
    { header: "Contrato", key: "key", width: 34 },
    { header: "Clase", key: "kind", width: 22 },
    { header: "Código", key: "code", width: 18 },
    { header: "Activo", key: "name", width: 30 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    ...(canViewMaintenance
      ? [
          { header: "Mantenciones", key: "maintenance", width: 16 },
          { header: "Backlog", key: "backlog", width: 12 },
        ]
      : []),
    ...(canViewInspections ? [{ header: "Inspecciones", key: "inspections", width: 16 }] : []),
    ...(canViewMaintenance ? [{ header: "Downtime (h)", key: "downtime", width: 16 }] : []),
    ...(showCost ? [{ header: "Costo mantenciones", key: "cost", width: 20 }] : []),
  ]
}

/**
 * Fila de un activo para la hoja "Activos". El estado se exporta con la
 * etiqueta humana (`operationalStatusLabel`), nunca el enum crudo (regla A6),
 * y las claves coinciden exactamente con las columnas devueltas por
 * `buildOperationalAssetExportColumns`.
 */
export function buildOperationalAssetExportRow(
  asset: OperationalAsset,
  canViewMaintenance: boolean,
  canViewInspections: boolean,
  canViewCosts: boolean,
): Record<string, string | number | null> {
  const showCost = canViewMaintenance && canViewCosts
  return {
    key: asset.key,
    kind: asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio",
    code: asset.code,
    name: asset.name,
    worksite: asset.worksiteName,
    status: asset.operationalStatusLabel,
    ...(canViewMaintenance ? { maintenance: asset.maintenanceCount, backlog: asset.openMaintenanceCount } : {}),
    ...(canViewInspections ? { inspections: asset.inspectionCount } : {}),
    ...(canViewMaintenance ? { downtime: asset.downtimeHours } : {}),
    ...(showCost ? { cost: asset.maintenanceCost } : {}),
  }
}
