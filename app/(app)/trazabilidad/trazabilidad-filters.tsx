"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface TrazabilidadFiltersProps {
  worksites: Array<{ id: string; name: string }>
  current: {
    faena?: string
    estado?: string
  }
}

const FILTER_ESTADOS = [
  { value: "alert", label: "Alerta: aprobado sin OC" },
  { value: "pending", label: "Pendiente de compra" },
  { value: "draft", label: "Borrador" },
  { value: "requested", label: "Solicitado" },
  { value: "approved", label: "Aprobado" },
  { value: "pending_purchase", label: "Pendiente compra" },
  { value: "in_purchase_order", label: "En OC" },
  { value: "purchased", label: "Comprado" },
  { value: "partially_received", label: "Rec. parcial" },
  { value: "received", label: "Recibido" },
  { value: "rejected", label: "Rechazado" },
  { value: "postponed", label: "Postergado" },
]

export function TrazabilidadFilters({ worksites, current }: TrazabilidadFiltersProps) {
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
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--color-text-muted)]">Faena</label>
        <Select
          defaultValue={current.faena ?? "all"}
          onValueChange={(v) => setFilter("faena", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-56"><SelectValue placeholder="Todas las faenas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--color-text-muted)]">Estado</label>
        <Select
          defaultValue={current.estado ?? "all"}
          onValueChange={(v) => setFilter("estado", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-56"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {FILTER_ESTADOS.map((e) => (
              <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(current.faena || current.estado) && (
        <Link
          href="/trazabilidad"
          className="inline-flex h-9 items-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline underline-offset-2"
        >
          Quitar filtros
        </Link>
      )}
    </div>
  )
}
