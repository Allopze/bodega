import { Button } from "@/components/ui/button"
import { FileXls } from "@phosphor-icons/react/dist/ssr"

export function ExportMaterialAmbientalButton({ year }: { year: number }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <a
        href={`/api/prevencion/indicadores-material-ambiental/export?year=${year}`}
        title="Exportar indicadores material y ambiental"
      >
      <FileXls className="h-4 w-4 mr-1" />
      Exportar Excel
      </a>
    </Button>
  )
}
