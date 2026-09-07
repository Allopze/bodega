import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { FilterSelect } from "@/components/ui/filter-select"

interface Option { id: string; name: string; worksiteId?: string }

export function TaeFilters({
  values,
  worksites,
  loadingPoints,
}: {
  values: { q: string; from: string; to: string; worksiteId: string; loadingPointId: string; status: string; seal: string; evidence: string }
  worksites: Option[]
  loadingPoints: Option[]
}) {
  const moreFiltersCount = [values.loadingPointId, values.seal, values.evidence].filter(Boolean).length
  return (
    <form method="get" className="mb-5 border border-(--color-border) bg-(--color-surface-2) p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <div className="sm:col-span-2"><Label htmlFor="tae-q">Buscar</Label><Input id="tae-q" name="q" defaultValue={values.q} placeholder="Equipo, patente o responsable" /></div>
        <div><Label htmlFor="tae-from">Desde</Label><DatePicker id="tae-from" name="from" defaultValue={values.from} placeholder="Desde" /></div>
        <div><Label htmlFor="tae-to">Hasta</Label><DatePicker id="tae-to" name="to" defaultValue={values.to} placeholder="Hasta" /></div>
        <div><Label htmlFor="tae-worksite">Faena</Label><FilterSelect name="faena" defaultValue={values.worksiteId} ariaLabel="Filtrar por faena" options={worksites.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas" /></div>
        <div><Label htmlFor="tae-status">Estado</Label><FilterSelect name="estado" defaultValue={values.status} ariaLabel="Filtrar por estado" options={[{ value: "submitted", label: "Recibida" }, { value: "observed", label: "Observada" }, { value: "validated", label: "Validada" }, { value: "voided", label: "Anulada" }]} placeholder="Todos" /></div>
      </div>
      <details className="mt-3 rounded-[var(--radius-md)] border border-(--color-border) bg-(--color-surface)">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-(--color-text)">Más filtros{moreFiltersCount > 0 ? ` (${moreFiltersCount} activos)` : ""}</summary>
        <div className="grid gap-3 border-t border-(--color-border) p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label htmlFor="tae-point">Punto</Label><FilterSelect name="punto" defaultValue={values.loadingPointId} ariaLabel="Filtrar por punto de carga" options={loadingPoints.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos" /></div>
          <div><Label htmlFor="tae-seal">Sellos</Label><FilterSelect name="sello" defaultValue={values.seal ? "faltante" : ""} ariaLabel="Filtrar por presencia de sellos" options={[{ value: "faltante", label: "Sello incompleto" }]} placeholder="Todos" /></div>
          <div><Label htmlFor="tae-evidence">Evidencia</Label><FilterSelect name="evidencia" defaultValue={values.evidence ? "faltante" : ""} ariaLabel="Filtrar por evidencia fotográfica" options={[{ value: "faltante", label: "Menos de 4 fotos" }]} placeholder="Todas" /></div>
        </div>
      </details>
      <div className="mt-3 flex gap-2"><Button type="submit" size="sm">Aplicar filtros</Button><Button asChild type="button" variant="ghost" size="sm"><Link href="/combustibles/tae">Limpiar</Link></Button></div>
    </form>
  )
}
