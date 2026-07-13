import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"

interface Option { id: string; name: string; worksiteId?: string }

export function TaeFilters({
  values,
  worksites,
  loadingPoints,
}: {
  values: { q: string; from: string; to: string; worksiteId: string; loadingPointId: string; status: string }
  worksites: Option[]
  loadingPoints: Option[]
}) {
  const selectClass = "h-9 w-full rounded-[var(--radius-md)] border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
  return (
    <form method="get" className="mb-5 border border-(--color-border) bg-(--color-surface-2) p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2"><Label htmlFor="tae-q">Buscar</Label><Input id="tae-q" name="q" defaultValue={values.q} placeholder="Equipo, patente o responsable" /></div>
        <div><Label htmlFor="tae-from">Desde</Label><Input id="tae-from" name="from" type="date" defaultValue={values.from} /></div>
        <div><Label htmlFor="tae-to">Hasta</Label><Input id="tae-to" name="to" type="date" defaultValue={values.to} /></div>
        <div><Label htmlFor="tae-worksite">Faena</Label><select aria-label="Filtrar por faena" id="tae-worksite" name="faena" defaultValue={values.worksiteId} className={selectClass}><option value="">Todas</option>{worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><Label htmlFor="tae-point">Punto</Label><select aria-label="Filtrar por punto de carga" id="tae-point" name="punto" defaultValue={values.loadingPointId} className={selectClass}><option value="">Todos</option>{loadingPoints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><Label htmlFor="tae-status">Estado</Label><select aria-label="Filtrar por estado" id="tae-status" name="estado" defaultValue={values.status} className={selectClass}><option value="">Todos</option><option value="submitted">Recibida</option><option value="observed">Observada</option><option value="validated">Validada</option><option value="voided">Anulada</option></select></div>
      </div>
      <div className="mt-3 flex gap-2"><Button type="submit" size="sm">Aplicar filtros</Button><Button asChild type="button" variant="ghost" size="sm"><Link href="/combustibles/tae">Limpiar</Link></Button></div>
    </form>
  )
}
