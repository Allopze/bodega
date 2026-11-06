"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

export interface ChoiceChipOption {
  value: string
  /** Lo que se ve en la ficha: «A4», «A2 antigua». */
  label: string
  /** Una línea corta bajo la etiqueta y nombre completo para lectores de pantalla. */
  description?: string
  /** Id del grupo al que pertenece (debe existir en `groups`). */
  group?: string
}

export interface ChoiceChipsProps {
  options: ChoiceChipOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** Si se pasa, emite un `<input type="hidden" name>` por valor para `<form action>`. */
  name?: string
  /** Grupos en el orden en que se muestran. Sin grupos, una sola grilla. */
  groups?: Array<{ id: string; label: string }>
  /**
   * Valores sugeridos (p. ej. lo que exige el cargo): borde punteado, sin
   * marcarlos. La sugerencia no decide por la persona.
   */
  suggested?: readonly string[]
  /** Id del rótulo visible (el `<Label>` del `Field`). */
  "aria-labelledby"?: string
  "aria-describedby"?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/**
 * Selección múltiple de opciones cortas (clases de licencia, días…) como
 * botones conmutables. No existía: `SegmentedControl` es de una sola opción y
 * `ChoiceCardGroup` es una tarjeta por opción, demasiado grande para doce.
 *
 * Cada opción es un `<button aria-pressed>` dentro de un `role="group"`: el
 * lector anuncia «A4, Transporte de carga simple…, presionado». El estado no
 * depende del color: la opción marcada lleva un check.
 */
export function ChoiceChips({
  options,
  value,
  onChange,
  name,
  groups,
  suggested = [],
  disabled,
  invalid,
  className,
  ...aria
}: ChoiceChipsProps) {
  const baseId = React.useId()
  const selected = React.useMemo(() => new Set(value), [value])
  const suggestedSet = React.useMemo(() => new Set(suggested), [suggested])

  const toggle = (optionValue: string) => {
    const next = selected.has(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]
    // Conserva el orden de `options`, no el del clic: lo guardado se lee igual siempre.
    const order = new Map(options.map((option, index) => [option.value, index]))
    onChange(next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))
  }

  const renderOption = (option: ChoiceChipOption) => {
    const isOn = selected.has(option.value)
    const isSuggested = !isOn && suggestedSet.has(option.value)
    return (
      <button
        key={option.value}
        type="button"
        aria-pressed={isOn}
        disabled={disabled}
        onClick={() => toggle(option.value)}
        title={option.description}
        className={cn(
          "group relative flex min-h-11 min-w-0 flex-col items-start justify-center rounded-[var(--radius-md)] border px-3 py-2 text-left",
          "transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isOn
            ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
            : "border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-border-control-hover)] hover:bg-[var(--color-surface-2)]",
          isSuggested && "border-dashed border-[var(--color-primary)]",
        )}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{option.label}</span>
          <span
            aria-hidden
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full transition-opacity duration-150 motion-reduce:transition-none",
              isOn ? "bg-[var(--color-primary)] text-white opacity-100" : "opacity-0",
            )}
          >
            <Check size={10} weight="bold" />
          </span>
        </span>
        {option.description && (
          <span className={cn("mt-0.5 line-clamp-2 text-[11px] leading-snug", isOn ? "text-[var(--color-primary-ink)]" : "text-[var(--color-text-muted)]")}>
            {option.description}
          </span>
        )}
      </button>
    )
  }

  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3"

  return (
    <div
      role="group"
      // `aria-invalid` no aplica a `role="group"`: el error lo anuncia el texto
      // del `Field`, enlazado por `aria-describedby`.
      data-invalid={invalid || undefined}
      className={cn("flex flex-col gap-3", className)}
      {...aria}
    >
      {groups && groups.length > 0
        ? groups.map((group) => {
          const items = options.filter((option) => option.group === group.id)
          if (items.length === 0) return null
          const headingId = `${baseId}-${group.id}`
          return (
            <div key={group.id} role="group" aria-labelledby={headingId} className="flex flex-col gap-1.5">
              <span id={headingId} className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {group.label}
              </span>
              <div className={grid}>{items.map(renderOption)}</div>
            </div>
          )
        })
        : <div className={grid}>{options.map(renderOption)}</div>}
      {name && value.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
    </div>
  )
}
