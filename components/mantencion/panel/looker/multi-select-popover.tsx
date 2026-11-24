"use client"

import * as React from "react"
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface MultiOption {
  value: string
  label: string
  hint?: string
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
}

/**
 * Lista de casillas con buscador para los filtros de faena, código y frecuencia. El buscador
 * filtra sólo las OPCIONES del control (unas decenas o cientos), nunca los datos del tablero:
 * ésos se filtran en la consulta del servidor.
 */
export function MultiSelectPopover({
  label,
  options,
  values,
  onChange,
  searchPlaceholder = "Buscar...",
  emptyLabel = "Todas",
  disabled = false,
  className,
}: {
  label: string
  options: MultiOption[]
  values: string[]
  onChange: (values: string[]) => void
  searchPlaceholder?: string
  /** Rótulo de «sin selección»: «Todas» para faenas, «Todos» para códigos. */
  emptyLabel?: string
  disabled?: boolean
  className?: string
}) {
  const id = React.useId()
  const [query, setQuery] = React.useState("")
  const selected = new Set(values)
  const labels = values.map((value) => options.find((option) => option.value === value)?.label ?? value)
  const visible = React.useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return options
    return options.filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(needle))
  }, [options, query])

  const shown = values.length === 0
    ? emptyLabel
    : values.length === 1
      ? labels[0] ?? emptyLabel
      : `${values.length} seleccionados`

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange([...next])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-label={`${label}: ${shown}`}
          className={cn("h-11 w-auto max-w-full justify-between gap-2 sm:h-9", className)}
        >
          <span className="min-w-0 truncate text-left">
            <span className="text-[var(--color-text-muted)]">{label}: </span>
            <span className="font-medium text-[var(--color-text)]">{shown}</span>
          </span>
          <CaretDown size={12} aria-hidden className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      {/* `collisionPadding`: en móvil el popover quedaba pegado al borde derecho de la pantalla. */}
      <PopoverContent align="start" collisionPadding={16} className="w-72 p-3">
        <p className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
        {options.length > 6 && (
          <div className="relative mb-2">
            <MagnifyingGlass size={13} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={`Buscar ${label.toLocaleLowerCase("es-CL")}`}
              className="h-9 pl-7"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto overscroll-y-contain">
          <div className="border-b border-[var(--color-border)] pb-1.5">
            <Checkbox
              id={`${id}-all`}
              checked={values.length === 0}
              onChange={() => onChange([])}
              label={emptyLabel}
            />
          </div>
          <div className="space-y-1.5 pt-1.5">
            {visible.length === 0 ? (
              <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">Ninguna opción coincide.</p>
            ) : visible.map((option) => (
              <Checkbox
                key={option.value}
                id={`${id}-${option.value}`}
                checked={selected.has(option.value)}
                onChange={() => toggle(option.value)}
                label={(
                  // La faena pasa a la línea de abajo cuando no cabe: antes iba `shrink-0` y el
                  // código («QA-LK-A1 · QALK…») era lo que se cortaba.
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="break-words">{option.label}</span>
                    {option.hint && <span className="break-words font-mono text-2xs text-[var(--color-text-subtle)]">{option.hint}</span>}
                  </span>
                )}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
