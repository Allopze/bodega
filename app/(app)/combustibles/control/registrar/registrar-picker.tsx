"use client"

import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Option { id: string; name: string }

/** Faena y lugar de carga. Cambiar la selección es un cambio de vista: `replace` sin scroll, como los filtros. */
export function RegistrarPicker({
  worksites,
  points,
  worksiteId,
  pointId,
}: {
  worksites: Option[]
  points: Array<Option & { worksiteId: string }>
  worksiteId: string
  pointId: string
}) {
  const router = useRouter()
  const worksitePoints = points.filter((point) => point.worksiteId === worksiteId)

  function go(nextWorksite: string, nextPoint: string) {
    const params = new URLSearchParams()
    if (nextWorksite) params.set("faena", nextWorksite)
    if (nextPoint) params.set("lugar", nextPoint)
    router.replace(`/combustibles/control/registrar${params.size ? `?${params}` : ""}`, { scroll: false })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="registrar-faena">Faena</Label>
        <Select value={worksiteId} onValueChange={(value) => {
          const only = points.filter((point) => point.worksiteId === value)
          go(value, only.length === 1 ? only[0]!.id : "")
        }}>
          <SelectTrigger id="registrar-faena"><SelectValue placeholder="Elige la faena" /></SelectTrigger>
          <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="registrar-lugar">Lugar de carga</Label>
        <Select value={pointId} onValueChange={(value) => go(worksiteId, value)} disabled={!worksiteId}>
          <SelectTrigger id="registrar-lugar"><SelectValue placeholder={worksiteId && worksitePoints.length === 0 ? "Esta faena no tiene lugares activos" : "Elige el lugar"} /></SelectTrigger>
          <SelectContent>{worksitePoints.map((point) => <SelectItem key={point.id} value={point.id}>{point.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  )
}
