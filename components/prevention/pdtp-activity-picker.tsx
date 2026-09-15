"use client"

import * as React from "react"
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type PdtpActivityPickerOption = {
  id: string
  code: string
  title: string
  description: string
  status: "draft" | "active" | "retired"
  annualNumber?: number | null
}

type SharedProps = {
  options: PdtpActivityPickerOption[]
  label: string
  disabled?: boolean
  className?: string
}

type PickerProps = SharedProps & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
)

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")

export function PdtpActivityPicker(props: PickerProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const selectedIds = React.useMemo(
    () => new Set(props.multiple ? props.value : props.value ? [props.value] : []),
    [props.multiple, props.value],
  )
  const selected = props.options.filter((option) => selectedIds.has(option.id))
  const visible = React.useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return props.options
    return props.options.filter((option) => normalize(`${option.code} ${option.title} ${option.description}`).includes(needle))
  }, [props.options, query])

  const triggerLabel = props.multiple
    ? `${selected.length} ${selected.length === 1 ? "actividad seleccionada" : "actividades seleccionadas"}`
    : selected[0]?.title ?? "Seleccionar actividad"

  function choose(option: PdtpActivityPickerOption) {
    const alreadySelected = selectedIds.has(option.id)
    if (option.status !== "active" && !alreadySelected) return
    if (props.multiple) {
      props.onChange(alreadySelected ? props.value.filter((id) => id !== option.id) : [...props.value, option.id])
      return
    }
    props.onChange(option.id)
    setOpen(false)
    setQuery("")
  }

  return (
    <div className={cn("space-y-1.5", props.className)}>
      <span className="text-sm font-medium text-(--color-text)">{props.label}</span>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            disabled={props.disabled}
            aria-label={triggerLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-left">{triggerLabel}</span>
            <CaretDown size={14} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(42rem,calc(100vw-2rem))] p-0">
          <div className="relative border-b border-(--color-border) p-3">
            <MagnifyingGlass size={15} aria-hidden="true" className="absolute left-5 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" />
            <input
              type="search"
              aria-label="Buscar actividad"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por título, descripción o código"
              className="h-9 w-full rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) pl-8 pr-3 text-sm text-(--color-text) focus:border-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary-line)"
            />
          </div>
          <div role="listbox" aria-multiselectable={props.multiple || undefined} className="max-h-80 overflow-y-auto p-1.5">
            {visible.length === 0 && <p className="px-3 py-6 text-center text-sm text-(--color-text-muted)">No hay actividades que coincidan.</p>}
            {visible.map((option) => {
              const isSelected = selectedIds.has(option.id)
              const unavailable = option.status !== "active"
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={unavailable ? "true" : undefined}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-(--radius) px-3 py-2.5 text-left",
                    isSelected ? "bg-(--color-primary-tint)" : "hover:bg-(--color-surface-2)",
                    unavailable && !isSelected && "cursor-not-allowed opacity-55",
                  )}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-(--color-border)", isSelected && "border-(--color-primary) bg-(--color-primary) text-white")}>
                    {isSelected && <Check size={11} weight="bold" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-(--color-text)">{option.title}</span>
                      {option.annualNumber != null && <span className="text-xs font-semibold text-(--color-primary-ink)">N°{option.annualNumber}</span>}
                    </span>
                    <span className="mt-0.5 block text-sm leading-5 text-(--color-text-muted)">{option.description}</span>
                    <span className="mt-1 block font-mono text-[11px] text-(--color-text-subtle)">{option.code}{unavailable ? ` · ${option.status === "retired" ? "Retirada" : "Borrador"}` : ""}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
