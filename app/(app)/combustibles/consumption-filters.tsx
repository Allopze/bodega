"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { SpinnerGap } from "@phosphor-icons/react"
import { Label } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fuelRecordSourceLabel } from "@/lib/combustibles/source-labels"
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

const FILTER_KEYS = ["fuente", "patente", "asociacion", "proveedor"] as const

const LINK_LABEL = { yes: "Con equipo vinculado", no: "Sin equipo vinculado" } as const

function buildChips(filters: ConsumptionFiltersProps["currentFilters"], proveedor: string | undefined): ActiveFilterChip[] {
  const chips: Array<ActiveFilterChip | null> = [
    filters.fuente ? { key: "fuente", label: "Fuente", value: filters.fuente, displayValue: fuelRecordSourceLabel(filters.fuente) } : null,
    filters.patente ? { key: "patente", label: "Patente", value: filters.patente, displayValue: filters.patente } : null,
    filters.associated ? { key: "asociacion", label: "Vínculo", value: filters.associated, displayValue: LINK_LABEL[filters.associated] } : null,
    proveedor ? { key: "proveedor", label: "Proveedor", value: proveedor, displayValue: proveedor } : null,
  ]
  return chips.filter((chip): chip is ActiveFilterChip => chip !== null)
}

/**
 * Filtros de los análisis de «Consumo»: es el `FilterToolbar` compartido. A la
 * vista, la fuente (sólo tarjetas) y la patente; tras «Más filtros (N)», si la
 * patente está vinculada a un equipo. El proveedor se fija desde el gráfico de la
 * planilla y aparece como chip. El período no se elige aquí —vive en la cabecera—
 * y la faena es la de toda la pantalla. Todo en la URL, con `router.replace` y
 * sin mover el scroll.
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

  return (
    <section className="mb-2" aria-labelledby="consumption-filters-title" aria-busy={isPending || undefined}>
      <h3 id="consumption-filters-title" className="sr-only">Filtros del análisis de tarjetas</h3>
      <FilterToolbar
        className="mb-4"
        activeChips={chips}
        onRemoveChip={(key) => go({ [key]: null })}
        onClearAll={() => go(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
        hasActiveFilters={chips.length > 0}
        activeCount={currentFilters.associated ? 1 : 0}
        overflowTitle="Más filtros del análisis"
        overflowDescription="Si la patente ya está vinculada a un equipo de la flota."
        overflowFilters={
          <div className="flex flex-col gap-1.5">
            <Label id="consumo-asociacion-label" className="text-xs">Vínculo con un equipo</Label>
            <Select value={currentFilters.associated ?? "all"} onValueChange={(value) => go({ asociacion: value === "all" ? null : value })}>
              <SelectTrigger aria-labelledby="consumo-asociacion-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las patentes</SelectItem>
                <SelectItem value="yes">{LINK_LABEL.yes}</SelectItem>
                <SelectItem value="no">{LINK_LABEL.no}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {section === "tarjetas" ? (
          <Select value={currentFilters.fuente ?? "all"} onValueChange={(value) => go({ fuente: value === "all" ? null : value })}>
            <SelectTrigger aria-label="Fuente" className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las fuentes</SelectItem>
              {fuentes.map((fuente) => <SelectItem key={fuente} value={fuente}>{fuelRecordSourceLabel(fuente)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-2">
          <Label htmlFor="consumo-patente" className="sr-only">Patente</Label>
          <Input
            id="consumo-patente"
            // eslint-disable-next-line local/ui-type-scale -- normaliza el dato, no es un rótulo
            className="w-40 uppercase"
            placeholder="Patente, ej. ABCD12"
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
        {isPending ? <SpinnerGap size={16} className="animate-spin text-[var(--color-primary)]" aria-label="Actualizando análisis" /> : null}
      </FilterToolbar>
    </section>
  )
}
