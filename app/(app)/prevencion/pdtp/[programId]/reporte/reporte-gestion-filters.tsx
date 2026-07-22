"use client"

import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ALL = "__all__"
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

type Filters = {
  faena?: string
  responsable?: string
  objetivo?: number
  estado?: string
  desde?: number
  hasta?: number
}

export function ReporteGestionFilters({
  programId,
  worksites,
  responsibleOptions,
  current,
}: {
  programId: string
  worksites: Array<{ id: string; name: string }>
  responsibleOptions: string[]
  current: Filters
}) {
  const router = useRouter()

  function navigate(next: Partial<Filters>) {
    const merged = { ...current, ...next }
    const params = new URLSearchParams()
    if (merged.faena) params.set("faena", merged.faena)
    if (merged.responsable) params.set("responsable", merged.responsable)
    if (merged.objetivo !== undefined) params.set("objetivo", String(merged.objetivo))
    if (merged.estado) params.set("estado", merged.estado)
    if (merged.desde !== undefined) params.set("desde", String(merged.desde))
    if (merged.hasta !== undefined) params.set("hasta", String(merged.hasta))
    router.push(`/prevencion/pdtp/${programId}/reporte?${params}`)
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {worksites.length > 1 && (
        <Select value={current.faena ?? ALL} onValueChange={(value) => navigate({ faena: value === ALL ? undefined : value })}>
          <SelectTrigger className="w-48" aria-label="Faena"><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} disabled>Selecciona faena</SelectItem>
            {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {responsibleOptions.length > 0 && (
        <Select value={current.responsable ?? ALL} onValueChange={(value) => navigate({ responsable: value === ALL ? undefined : value })}>
          <SelectTrigger className="w-56" aria-label="Responsable"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los responsables</SelectItem>
            {responsibleOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={current.estado ?? ALL} onValueChange={(value) => navigate({ estado: value === ALL ? undefined : value })}>
        <SelectTrigger className="w-44" aria-label="Estado"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los estados</SelectItem>
          <SelectItem value="meets">Cumple meta</SelectItem>
          <SelectItem value="deviates">En desviación</SelectItem>
        </SelectContent>
      </Select>
      <Select value={current.desde !== undefined ? String(current.desde) : ALL} onValueChange={(value) => navigate({ desde: value === ALL ? undefined : Number(value) })}>
        <SelectTrigger className="w-32" aria-label="Desde"><SelectValue placeholder="Desde" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Desde</SelectItem>
          {MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={current.hasta !== undefined ? String(current.hasta) : ALL} onValueChange={(value) => navigate({ hasta: value === ALL ? undefined : Number(value) })}>
        <SelectTrigger className="w-32" aria-label="Hasta"><SelectValue placeholder="Hasta" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Hasta</SelectItem>
          {MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
