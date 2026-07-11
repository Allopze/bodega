"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface FleetFiltersProps {
  operationalStatuses: string[]
  responsibleUsers: Array<{ id: string; name: string }>
  current: {
    estado?: string
    responsable?: string
    vencimiento?: string
  }
  warningDays: number
}

export function FleetFilters({ operationalStatuses, responsibleUsers, current, warningDays }: FleetFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Select
        defaultValue={current.estado ?? "all"}
        onValueChange={(v) => setFilter("estado", v === "all" ? "" : v)}
      >
        <SelectTrigger><SelectValue placeholder="Todos los estados" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {operationalStatuses.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.responsable ?? "all"}
        onValueChange={(v) => setFilter("responsable", v === "all" ? "" : v)}
      >
        <SelectTrigger><SelectValue placeholder="Todos los responsables" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los responsables</SelectItem>
          {responsibleUsers.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.vencimiento ?? "all"}
        onValueChange={(v) => setFilter("vencimiento", v === "all" ? "" : v)}
      >
        <SelectTrigger><SelectValue placeholder="Sin filtro de vencimiento" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Sin filtro de vencimiento</SelectItem>
          <SelectItem value="vencidos">Documentos vencidos</SelectItem>
          <SelectItem value="proximos">Próximos a vencer ({warningDays} días)</SelectItem>
          <SelectItem value="al-dia">Al día</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/flota">Limpiar filtros</Link>
        </Button>
      </div>
    </div>
  )
}
