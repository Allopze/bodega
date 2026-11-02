import type { OperationalAsset } from "@/lib/services/operational-control"

export interface OperationalExportColumn {
  header: string
  key: string
  width: number
}

export function buildOperationalAssetExportColumns(canViewInspections: boolean): OperationalExportColumn[] {
  return [
    { header: "Contrato", key: "key", width: 34 },
    { header: "Clase", key: "kind", width: 22 },
    { header: "Código", key: "code", width: 18 },
    { header: "Activo", key: "name", width: 30 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    ...(canViewInspections ? [{ header: "Inspecciones", key: "inspections", width: 16 }] : []),
  ]
}

/** Estado humano y claves alineadas con las columnas devueltas arriba. */
export function buildOperationalAssetExportRow(
  asset: OperationalAsset,
  canViewInspections: boolean,
): Record<string, string | number | null> {
  return {
    key: asset.key,
    kind: asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio",
    code: asset.code,
    name: asset.name,
    worksite: asset.worksiteName,
    status: asset.operationalStatusLabel,
    ...(canViewInspections ? { inspections: asset.inspectionCount } : {}),
  }
}
