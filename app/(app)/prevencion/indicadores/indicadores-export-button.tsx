import { Button } from "@/components/ui/button"
import { FileXls } from "@phosphor-icons/react/dist/ssr"

export function ExportIndicadoresButton({ year }: { year: number }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <a
        href={`/api/prevencion/indicadores/export?year=${year}`}
        title="Exportar cálculo canónico, fuentes y conciliación"
      >
      <FileXls className="h-4 w-4 mr-1" />
      Exportar XLSX
      </a>
    </Button>
  )
}
