import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"

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
  const selectClass = "h-9 w-full rounded-[var(--radius-md)] border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
  const moreFiltersCount = [values.loadingPointId, values.seal, values.evidence].filter(Boolean).length
  return (
    <form method="get" className="mb-5 border border-(--color-border) bg-(--color-surface-2) p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <div className="sm:col-span-2"><Label htmlFor="tae-q">Buscar</Label><Input id="tae-q" name="q" defaultValue={values.q} placeholder="Equipo, patente o responsable" /></div>
        <div><Label htmlFor="tae-from">Desde</Label><DatePicker id="tae-from" name="from" defaultValue={values.from} placeholder="Desde" /></div>
        <div><Label htmlFor="tae-to">Hasta</Label><DatePicker id="tae-to" name="to" defaultValue={values.to} placeholder="Hasta" /></div>
        <div><Label htmlFor="tae-worksite">Faena</Label><select aria-label="Filtrar por faena" id="tae-worksite" name="faena" defaultValue={values.worksiteId} className={selectClass}><option value="">Todas</option>{worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><Label htmlFor="tae-status">Estado</Label><select aria-label="Filtrar por estado" id="tae-status" name="estado" defaultValue={values.status} className={selectClass}><option value="">Todos</option><option value="submitted">Recibida</option><option value="observed">Observada</option><option value="validated">Validada</option><option value="voided">Anulada</option></select></div>
      </div>
      <details className="mt-3 rounded-[var(--radius-md)] border border-(--color-border) bg-(--color-surface)">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-(--color-text)">Más filtros{moreFiltersCount > 0 ? ` (${moreFiltersCount} activos)` : ""}</summary>
        <div className="grid gap-3 border-t border-(--color-border) p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label htmlFor="tae-point">Punto</Label><select aria-label="Filtrar por punto de carga" id="tae-point" name="punto" defaultValue={values.loadingPointId} className={selectClass}><option value="">Todos</option>{loadingPoints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div><Label htmlFor="tae-seal">Sellos</Label><select aria-label="Filtrar por presencia de sellos" id="tae-seal" name="sello" defaultValue={values.seal ? "faltante" : ""} className={selectClass}><option value="">Todos</option><option value="faltante">Sello incompleto</option></select></div>
          <div><Label htmlFor="tae-evidence">Evidencia</Label><select aria-label="Filtrar por evidencia fotográfica" id="tae-evidence" name="evidencia" defaultValue={values.evidence ? "faltante" : ""} className={selectClass}><option value="">Todas</option><option value="faltante">Menos de 4 fotos</option></select></div>
        </div>
      </details>
      <div className="mt-3 flex gap-2"><Button type="submit" size="sm">Aplicar filtros</Button><Button asChild type="button" variant="ghost" size="sm"><Link href="/combustibles/tae">Limpiar</Link></Button></div>
    </form>
  )
}
