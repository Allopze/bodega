"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"

const ALL = "_all"

interface AssetFiltersProps {
  types: { id: string; name: string; category: string }[]
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
  current: Record<string, string | string[] | undefined>
}

const WARRANTY_OPTIONS = [
  { value: "active", label: "Garantía vigente" },
  { value: "expiring_30", label: "Vence en 30 días" },
  { value: "expiring_60", label: "Vence en 60 días" },
  { value: "expiring_90", label: "Vence en 90 días" },
  { value: "expired", label: "Garantía vencida" },
  { value: "none", label: "Sin garantía" },
]

const AGE_OPTIONS = [
  { value: "3", label: "Hasta 3 años" },
  { value: "5", label: "Hasta 5 años" },
  { value: "10", label: "Hasta 10 años" },
]

function workerLabel(w: { name: string; lastName: string }) {
  return `${w.name} ${w.lastName}`.trim()
}

function SelectFilter({ value, onValue, allLabel, ariaLabel, options }: {
  value: string
  onValue: (v: string) => void
  allLabel: string
  ariaLabel: string
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value || ALL} onValueChange={onValue}>
      <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function AssetFilters({ types, workers, worksites, suppliers, current }: AssetFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === "string" && v) params.set(k, v)
    }
    if (value && value !== ALL) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const overflowKeys = ["trabajador", "proveedor", "garantia", "antiguedad"] as const
  const activeCount = overflowKeys.filter((key) => typeof current[key] === "string" && current[key]).length

  const overflowFilters = (
    <div className="flex flex-col gap-3 py-2">
      <SelectFilter
        value={String(current.trabajador ?? "")}
        onValue={(v) => setParam("trabajador", v)}
        allLabel="Todos los trabajadores"
        ariaLabel="Filtrar por trabajador"
        options={workers.map((w) => ({ value: w.id, label: workerLabel(w) }))}
      />
      <SelectFilter
        value={String(current.proveedor ?? "")}
        onValue={(v) => setParam("proveedor", v)}
        allLabel="Todos los proveedores"
        ariaLabel="Filtrar por proveedor"
        options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
      />
      <SelectFilter
        value={String(current.garantia ?? "")}
        onValue={(v) => setParam("garantia", v)}
        allLabel="Toda garantía"
        ariaLabel="Filtrar por garantía"
        options={WARRANTY_OPTIONS}
      />
      <SelectFilter
        value={String(current.antiguedad ?? "")}
        onValue={(v) => setParam("antiguedad", v)}
        allLabel="Toda antigüedad"
        ariaLabel="Filtrar por antigüedad"
        options={AGE_OPTIONS}
      />
    </div>
  )

  return (
    <FilterToolbar
      overflowFilters={overflowFilters}
      activeCount={activeCount}
      onClearAll={() => router.replace(pathname)}
    >
      <SelectFilter
        value={String(current.tipo ?? "")}
        onValue={(v) => setParam("tipo", v)}
        allLabel="Todos los tipos"
        ariaLabel="Filtrar por tipo"
        options={types.map((t) => ({ value: t.id, label: t.name }))}
      />
      <SelectFilter
        value={String(current.estado ?? "")}
        onValue={(v) => setParam("estado", v)}
        allLabel="Todos los estados"
        ariaLabel="Filtrar por estado"
        options={Object.entries(IT_ASSET_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
      />
      <SelectFilter
        value={String(current.faena ?? "")}
        onValue={(v) => setParam("faena", v)}
        allLabel="Todas las faenas"
        ariaLabel="Filtrar por faena"
        options={worksites.map((w) => ({ value: w.id, label: w.name }))}
      />
    </FilterToolbar>
  )
}
