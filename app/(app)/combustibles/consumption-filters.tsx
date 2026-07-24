"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowCounterClockwise, FunnelSimple, SpinnerGap, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildConsumptionHref } from "./consumption-url"

interface ConsumptionFiltersProps {
  worksites: Array<{ id: string; name: string }>
  fuentes: string[]
  currentFilters: {
    fromDate: string
    toDate: string
    worksiteId?: string
    fuente?: string
    patente?: string
    associated?: "yes" | "no"
  }
  hasExplicitDateRange: boolean
  /** Filtro de proveedor: sólo alimenta el log operacional (no es parte de `ConsumptionFilters`), pero se muestra y retira desde aquí igual que el resto. */
  proveedor?: string
}

interface FilterChip { key: string; label: string }

function buildChips(filters: ConsumptionFiltersProps["currentFilters"], hasExplicitDateRange: boolean, proveedor: string | undefined, worksites: Array<{ id: string; name: string }>): FilterChip[] {
  const chips: Array<FilterChip | null> = [
    hasExplicitDateRange ? { key: "desde", label: `Período: ${filters.fromDate} a ${filters.toDate}` } : null,
    filters.worksiteId ? { key: "faena", label: `Faena: ${worksites.find((w) => w.id === filters.worksiteId)?.name ?? filters.worksiteId}` } : null,
    filters.fuente ? { key: "fuente", label: `Fuente: ${filters.fuente}` } : null,
    filters.patente ? { key: "patente", label: `Patente: ${filters.patente}` } : null,
    filters.associated ? { key: "asociacion", label: filters.associated === "yes" ? "Con vehículo asociado" : "Sin vehículo asociado" } : null,
    proveedor ? { key: "proveedor", label: `Proveedor: ${proveedor}` } : null,
  ]
  return chips.filter((chip): chip is FilterChip => chip !== null)
}

export function ConsumptionFiltersBar({
  worksites,
  fuentes,
  currentFilters,
  hasExplicitDateRange,
  proveedor,
}: ConsumptionFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [patenteDraft, setPatenteDraft] = useState(currentFilters.patente ?? "")
  const chips = useMemo(
    () => buildChips(currentFilters, hasExplicitDateRange, proveedor, worksites),
    [currentFilters, hasExplicitDateRange, proveedor, worksites],
  )

  // Resincroniza el input cuando la patente cambia en la URL (p. ej. al quitar
  // un chip). Ajustar durante el render en vez de en un efecto evita que el
  // valor viejo alcance a pintarse.
  const [lastSyncedPatente, setLastSyncedPatente] = useState(currentFilters.patente ?? "")
  if (lastSyncedPatente !== (currentFilters.patente ?? "")) {
    setLastSyncedPatente(currentFilters.patente ?? "")
    setPatenteDraft(currentFilters.patente ?? "")
  }

  function setFilter(key: string, value: string) {
    const href = buildConsumptionHref(searchParams.toString(), { [key]: value })
    startTransition(() => router.replace(href, { scroll: false }))
  }

  function applyPatente() {
    setFilter("patente", patenteDraft.trim().toUpperCase())
  }

  function removeChip(key: string) {
    const changes = key === "desde" ? { desde: "", hasta: "" } : { [key]: "" }
    const href = buildConsumptionHref(searchParams.toString(), changes)
    startTransition(() => router.replace(href, { scroll: false }))
  }

  function clearFilters() {
    startTransition(() => router.replace("/combustibles", { scroll: false }))
  }

  return (
    <section className="mb-7 border border-[var(--color-border)] bg-[var(--color-surface)]" aria-labelledby="consumption-filters-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <FunnelSimple size={18} weight="bold" className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden />
          <div>
            <p className="text-eyebrow">Contexto de análisis</p>
            <h2 id="consumption-filters-title" className="text-base font-semibold text-[var(--color-text)]">Filtros de consumo</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">La tabla, los indicadores y los gráficos se actualizan con esta selección.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters} disabled={isPending}>
            <ArrowCounterClockwise className="mr-1.5 h-4 w-4" />Limpiar
          </Button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border)] px-4 py-2.5 md:px-5">
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => removeChip(chip.key)} disabled={isPending}>
              <Badge variant="outline" size="sm" className="inline-flex items-center gap-1 hover:bg-[var(--color-surface-2)]">{chip.label}<X size={10} /></Badge>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 md:px-5">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="consumo-desde" className="text-xs">Desde</Label>
          <DatePicker
            id="consumo-desde"
            value={currentFilters.fromDate}
            max={currentFilters.toDate}
            onChange={(value) => setFilter("desde", value)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="consumo-hasta" className="text-xs">Hasta</Label>
          <DatePicker
            id="consumo-hasta"
            value={currentFilters.toDate}
            min={currentFilters.fromDate}
            onChange={(value) => setFilter("hasta", value)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label id="consumo-faena-label" className="text-xs">Faena</Label>
          <Select value={currentFilters.worksiteId ?? "all"} onValueChange={(value) => setFilter("faena", value === "all" ? "" : value)}>
            <SelectTrigger aria-labelledby="consumo-faena-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label id="consumo-fuente-label" className="text-xs">Fuente</Label>
          <Select value={currentFilters.fuente ?? "all"} onValueChange={(value) => setFilter("fuente", value === "all" ? "" : value)}>
            <SelectTrigger aria-labelledby="consumo-fuente-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las fuentes</SelectItem>
              {fuentes.map((fuente) => <SelectItem key={fuente} value={fuente}>{fuente}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="consumo-patente" className="text-xs">Patente</Label>
          <Input
            id="consumo-patente"
            className="uppercase"
            placeholder="ABCD12"
            value={patenteDraft}
            onChange={(event) => setPatenteDraft(event.target.value.toUpperCase())}
            onBlur={applyPatente}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label id="consumo-asociacion-label" className="text-xs">Asociación</Label>
          <Select value={currentFilters.associated ?? "all"} onValueChange={(value) => setFilter("asociacion", value === "all" ? "" : value)}>
            <SelectTrigger aria-labelledby="consumo-asociacion-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las patentes</SelectItem>
              <SelectItem value="yes">Con vehículo asociado</SelectItem>
              <SelectItem value="no">Sin vehículo asociado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="flex min-h-8 items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)] md:px-5" aria-live="polite">
        {isPending && <SpinnerGap size={14} className="animate-spin text-[var(--color-primary)]" aria-hidden />}
        {isPending ? "Actualizando análisis…" : `Período efectivo: ${currentFilters.fromDate} a ${currentFilters.toDate}.`}
      </p>
    </section>
  )
}
