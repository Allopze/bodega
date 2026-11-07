import { ExportLink } from "@/components/ui/export-button"

export function ExportMaterialAmbientalButton({ year }: { year: number }) {
  return <ExportLink href={`/api/prevencion/indicadores-material-ambiental/export?year=${year}`} />
}
