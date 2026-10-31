"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowCounterClockwise, SpinnerGap, X } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildLitrosHref } from "./consumption-url"

interface ConsumptionFiltersProps {
  /** Sección de «Consumo» donde vive la barra: los cambios se quedan en ella. La planilla de cargas no tiene «fuente». */
  section: "tarjetas" | "planilla"
  fuentes: string[]
  currentFilters: {
    fuente?: string
    patente?: string
    associated?: "yes" | "no"
  }
  /** Filtro de proveedor: sólo alimenta la planilla de cargas (no es parte de `ConsumptionFilters`), pero se muestra y retira desde aquí igual que el resto. */
  proveedor?: string
}

interface FilterChip { key: string; label: string }

const FILTER_KEYS = ["fuente", "patente", "asociacion", "proveedor"] as const

function buildChips(filters: ConsumptionFiltersProps["currentFilters"], proveedor: string | undefined): FilterChip[] {
  const chips: Array<FilterChip | null> = [
    filters.fuente ? { key: "fuente", label: `Fuente: ${filters.fuente}` } : null,
    filters.patente ? { key: "patente", label: `Patente: ${filters.patente}` } : null,
    filters.associated ? { key: "asociacion", label: filters.associated === "yes" ? "Con vehículo asociado" : "Sin vehículo asociado" } : null,
    proveedor ? { key: "proveedor", label: `Proveedor: ${proveedor}` } : null,
  ]
  return chips.filter((chip): chip is FilterChip => chip !== null)
}

/**
 * Filtros de los análisis de «Consumo»: fuente (sólo tarjetas), patente y
 * asociación, más el proveedor, que se fija desde el gráfico de la planilla. El período ya no se
 * elige aquí —vive en la cabecera— y la faena es la de toda la pantalla. Cada
 * filtro activo queda como chip removible (A2). Todo en la URL, con
 * `router.replace` y sin mover el scroll.
 */
export function ConsumptionFiltersBar({ section, fuentes, currentFilters, proveedor }: ConsumptionFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [patenteDraft, setPatenteDraft] = useState(currentFilters.patente ?? "")
  const chips = useMemo(() => buildChips(currentFilters, proveedor), [currentFilters, proveedor])

  // Resincroniza el input cuando la patente cambia en la URL (p. ej. al quitar
  // un chip). Ajustar durante el render en vez de en un efecto evita que el
  // valor viejo alcance a pintarse.
  const [lastSyncedPatente, setLastSyncedPatente] = useState(currentFilters.patente ?? "")
  if (lastSyncedPatente !== (currentFilters.patente ?? "")) {
    setLastSyncedPatente(currentFilters.patente ?? "")
    setPatenteDraft(currentFilters.patente ?? "")
  }

  function go(changes: Record<string, string | null>) {
    startTransition(() => router.replace(buildLitrosHref(searchParams.toString(), changes, { section }), { scroll: false }))
  }

  function applyPatente() {
    const next = patenteDraft.trim().toUpperCase()
    if (next !== (currentFilters.patente ?? "")) go({ patente: next })
  }

  function clearFilters() {
    go(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))
  }

  return (
    <section className="mb-6" aria-labelledby="consumption-filters-title" aria-busy={isPending || undefined}>
      <h3 id="consumption-filters-title" className="sr-only">Filtros del análisis de tarjetas</h3>
      <div className="flex flex-wrap items-end gap-3">
        {section === "tarjetas" ? (
          <div className="flex min-w-0 flex-col gap-1">
            <Label id="consumo-fuente-label" className="text-xs">Fuente</Label>
            <Select value={currentFilters.fuente ?? "all"} onValueChange={(value) => go({ fuente: value === "all" ? null : value })}>
              <SelectTrigger aria-labelledby="consumo-fuente-label" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las fuentes</SelectItem>
                {fuentes.map((fuente) => <SelectItem key={fuente} value={fuente}>{fuente}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="consumo-patente" className="text-xs">Patente</Label>
          <Input
            id="consumo-patente"
            className="w-40 uppercase"
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
          <Select value={currentFilters.associated ?? "all"} onValueChange={(value) => go({ asociacion: value === "all" ? null : value })}>
            <SelectTrigger aria-labelledby="consumo-asociacion-label" className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las patentes</SelectItem>
              <SelectItem value="yes">Con vehículo asociado</SelectItem>
              <SelectItem value="no">Sin vehículo asociado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {chips.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters} disabled={isPending} className="min-h-10">
            <ArrowCounterClockwise className="mr-1.5 h-4 w-4" aria-hidden />Limpiar filtros
          </Button>
        ) : null}
        {isPending ? <SpinnerGap size={16} className="mb-2.5 animate-spin text-[var(--color-primary)]" aria-label="Actualizando análisis" /> : null}
      </div>

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">Filtros activos:</span>
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => go({ [chip.key]: null })} disabled={isPending} aria-label={`Quitar el filtro ${chip.label}`}>
              <Badge variant="outline" size="sm" className="inline-flex items-center gap-1 hover:bg-[var(--color-surface-2)]">{chip.label}<X size={10} aria-hidden /></Badge>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
