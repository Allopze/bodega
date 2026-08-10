"use client"

import * as React from "react"
import { CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
  /** Texto secundario (RUT, cargo, faena...) que también entra en la búsqueda. */
  hint?: string
}

interface ComboboxProps {
  id?:          string
  options:      ComboboxOption[]
  value:        string
  onChange:     (value: string) => void
  placeholder?: string
  /** Texto del ítem que limpia la selección. Omitir lo deja fuera (campo obligatorio). */
  clearLabel?:  string
  disabled?:    boolean
  /** Cuántas opciones se muestran sin escribir nada. */
  maxVisible?:  number
  className?:   string
  "aria-describedby"?: string
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
}

/**
 * Combobox accesible de una sola selección con búsqueda (WAI-ARIA 1.2):
 * `role="combobox"` en el input con `aria-expanded`/`aria-controls`/
 * `aria-activedescendant`, `role="listbox"` en el popup y `role="option"` en
 * cada fila; teclado ArrowUp/Down, Home/End, Enter, Escape.
 *
 * Existe porque un `<Select>` nativo con cientos de trabajadores no es
 * utilizable, y el catálogo de personas hay que buscarlo, no recorrerlo.
 * `ProductPicker` implementa este mismo patrón sobre su propio dominio
 * (variantes + ítem libre) y no se migró para no tocar un componente estable.
 */
export function Combobox({
  id, options, value, onChange, placeholder = "Buscar...", clearLabel,
  disabled = false, maxVisible = 50, className, ...rest
}: ComboboxProps) {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const listboxRef = React.useRef<HTMLUListElement>(null)
  const listboxId = React.useId()
  const optionId = (index: number) => `${listboxId}-opt-${index}`

  const selected = options.find((option) => option.value === value)

  const visible = React.useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return options.slice(0, maxVisible)
    return options
      .filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(needle))
      .slice(0, maxVisible)
  }, [options, query, maxVisible])

  const rows: ComboboxOption[] = clearLabel && !query.trim()
    ? [{ value: "", label: clearLabel }, ...visible]
    : visible
  const safeActiveIndex = activeIndex < rows.length ? activeIndex : Math.max(0, rows.length - 1)

  function commit(next: string) {
    onChange(next)
    setQuery("")
    setOpen(false)
    setActiveIndex(0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      if (rows.length === 0) return
      const delta = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((current) => (current + delta + rows.length) % rows.length)
      return
    }
    if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); return }
    if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(0, rows.length - 1)); return }
    if (event.key === "Enter") {
      if (!open) return
      event.preventDefault()
      const row = rows[safeActiveIndex]
      if (row) commit(row.value)
      return
    }
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false) }
  }

  // Con una selección hecha y el popup cerrado, el input muestra la etiqueta
  // elegida; al abrirlo pasa a ser el campo de búsqueda.
  const inputValue = open ? query : (selected?.label ?? "")

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <MagnifyingGlass
          size={14} weight="bold" aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-subtle)"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && rows.length > 0 ? optionId(safeActiveIndex) : undefined}
          aria-describedby={rest["aria-describedby"]}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className={cn(
            "h-8 w-full rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) pl-7 pr-7 text-sm",
            "text-(--color-text) placeholder:text-(--color-text-subtle)",
            "focus:outline-none focus:border-(--color-primary) focus:ring-2 focus:ring-(--color-primary-line)",
            "disabled:cursor-default disabled:opacity-100",
            "transition-[border-color,box-shadow] duration-(--duration-fast)",
          )}
          placeholder={placeholder}
          value={inputValue}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0) }}
          onFocus={() => { if (!disabled) setOpen(true) }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null
            if (next && listboxRef.current?.contains(next)) return
            setOpen(false)
            setQuery("")
          }}
          onKeyDown={handleKeyDown}
        />
        {!disabled && selected && clearLabel && (
          <button
            type="button"
            aria-label={clearLabel}
            onMouseDown={(event) => { event.preventDefault(); commit("") }}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-(--color-text-subtle) transition-colors duration-(--duration-fast) hover:text-(--color-danger)"
          >
            <X size={12} weight="bold" />
          </button>
        )}
        {!selected && (
          <CaretDown
            size={12} weight="bold" aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-(--color-text-subtle)"
          />
        )}
      </div>

      {open && rows.length > 0 && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          className="absolute z-20 top-full mt-1 left-0 right-0 max-h-52 overflow-y-auto rounded-(--radius-xl) bg-(--color-surface) shadow-(--shadow-md) py-1"
        >
          {rows.map((row, index) => (
            <li
              key={row.value || "__clear__"}
              id={optionId(index)}
              role="option"
              aria-selected={row.value === value}
              tabIndex={-1}
              onMouseDown={(event) => { event.preventDefault(); commit(row.value) }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-left transition-colors duration-(--duration-fast)",
                index === safeActiveIndex
                  ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
                  : "hover:bg-(--color-surface-2)",
              )}
            >
              <span className="text-sm truncate">{row.label}</span>
              {row.hint && <span className="ml-auto shrink-0 text-[11px] text-(--color-text-subtle)">{row.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
