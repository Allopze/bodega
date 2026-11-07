import { ExportLink } from "@/components/ui/export-button"

export function ExportIndicadoresButton({ year }: { year: number }) {
  // `ExportLink` no expone `title`: el tooltip (qué trae el archivo) va en el contenedor.
  return (
    <span title="Exportar cálculo canónico, fuentes y conciliación">
      <ExportLink href={`/api/prevencion/indicadores/export?year=${year}`} />
    </span>
  )
}
