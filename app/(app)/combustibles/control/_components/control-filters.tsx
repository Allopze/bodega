"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { MONTH_LABELS, cn } from "@/lib/utils"

const ALL = "_all"
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

interface Option { id: string; name: string }

export interface ControlFiltersProps {
  years: number[]
  defaultYear: number
  worksites: Option[]
  /** Si se pasa, aparece el selector de mandante (vistas C). */
  mandantes?: Option[]
  /** Parámetros propios de la vista que también deben borrarse al limpiar. */
  extraKeys?: string[]
  /** Filtros propios de la vista (unidad, medio, equipo, rango), en la misma fila. */
  children?: React.ReactNode
}

/**
 * Filtros globales del control (G-01): año, meses (selección múltiple), faena y
 * limpiar. Todo vive en la URL para poder compartir la vista. Los meses son
 * botones conmutables en vez de un desplegable: los doce quedan a la vista y se
 * eligen con un toque, también en terreno.
 */
export function ControlFilters({ years, defaultYear, worksites, mandantes, extraKeys = [], children }: ControlFiltersProps) {
  const searchParams = useSearchParams()
  const { setFilter, setFilters, isPending } = useUrlFilters({ pageKey: "pagina" })

  const year = searchParams.get("anio") ?? String(defaultYear)
  const months = new Set((searchParams.get("meses") ?? "").split(",").map(Number).filter((month) => month >= 1 && month <= 12))
  const worksiteId = searchParams.get("faena") ?? ""
  const mandanteId = searchParams.get("mandante") ?? ""
  const managedKeys = ["anio", "meses", "faena", "mandante", "desde", "hasta", ...extraKeys]
  const hasFilters = managedKeys.some((key) => searchParams.has(key))

  function toggleMonth(month: number) {
    const next = new Set(months)
    if (next.has(month)) next.delete(month)
    else next.add(month)
    setFilters({ meses: [...next].sort((left, right) => left - right).join(",") || null, desde: null, hasta: null })
  }

  function clearAll() {
    setFilters(Object.fromEntries(managedKeys.map((key) => [key, null])))
  }

  return (
    <div className="mb-6 flex flex-col gap-3" aria-busy={isPending || undefined}>
      <div className="flex flex-wrap items-end gap-2.5">
        <Select value={year} onValueChange={(value) => setFilters({ anio: value === String(defaultYear) ? null : value, desde: null, hasta: null })}>
          <SelectTrigger className="w-28" aria-label="Año">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((option) => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}
          </SelectContent>
        </Select>
        <WorksiteSelect
          worksites={worksites}
          value={worksiteId}
          onChange={(value) => setFilter("faena", value || null)}
          triggerClassName="w-56"
        />
        {mandantes ? (
          <Select value={mandanteId || ALL} onValueChange={(value) => setFilter("mandante", value === ALL ? null : value)}>
            <SelectTrigger className="w-56" aria-label="Mandante">
              <SelectValue placeholder="Todos los mandantes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los mandantes</SelectItem>
              {mandantes.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        {children}
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="min-h-10">
            Limpiar filtros
          </Button>
        ) : null}
      </div>
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">Meses de {year} (sin selección = año completo)</legend>
        {MONTH_LABELS.map((label, index) => {
          const month = index + 1
          const pressed = months.has(month)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={pressed}
              aria-label={`${MONTH_NAMES[index]} ${year}`}
              onClick={() => toggleMonth(month)}
              className={cn(
                "min-h-9 min-w-11 rounded-md border px-2 text-sm tabular-nums transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                pressed
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]"
                  : "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-control-hover)] hover:text-[var(--color-text)]",
              )}
            >
              {label}
            </button>
          )
        })}
        <span className="ml-2 text-xs text-[var(--color-text-faint)]">
          {months.size === 0 ? "Año completo" : `${months.size} ${months.size === 1 ? "mes" : "meses"}`}
        </span>
      </fieldset>
    </div>
  )
}
