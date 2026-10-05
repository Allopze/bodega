"use client"

import * as React from "react"
import { CaretDown, Check, MagnifyingGlass, X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useComboboxListbox } from "./use-combobox-listbox"

export interface ComboboxOption {
  value: string
  label: string
  /** Texto secundario (RUT, tipo de equipo…) que también entra en la búsqueda. */
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
  /**
   * Acepta un texto que no está en `options`: los diccionarios de la MIPER se
   * alimentan de lo que se escribe (spec MIPER 2026-10-02 §6.1). Muestra «Usar
   * «texto»» y, al salir del campo, confirma lo escrito. Al enfocarlo, el campo
   * conserva el valor actual para corregirlo en vez de vaciarse.
   */
  allowCustomValue?: boolean
  "aria-label"?: string
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
}

/**
 * Combobox accesible de una sola selección con búsqueda. La mecánica del patrón
 * (teclado, apertura, `aria-activedescendant`) vive en `useComboboxListbox`,
 * compartida con `ProductPicker`.
 *
 * Existe porque un `<select>` con cientos de trabajadores o equipos no es
 * utilizable: el catálogo de personas y de instrumentos hay que buscarlo, no
 * recorrerlo.
 */
export function Combobox({
  id, options, value, onChange, placeholder = "Buscar...", clearLabel,
  disabled = false, maxVisible = 50, className, allowCustomValue = false, ...rest
}: ComboboxProps) {
  const selected = options.find((option) => option.value === value)
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listboxRef = React.useRef<HTMLUListElement>(null)
  // Recién enfocado, sin escribir ni navegar: Enter no debe elegir la primera fila.
  const pristineRef = React.useRef(false)

  const currentText = selected?.label ?? (allowCustomValue ? value : "")
  // Un valor libre (`allowCustomValue`) también es un valor: con `clearLabel`
  // se limpia igual que una opción elegida (A2, fila 11).
  const hasValue = Boolean(selected) || (allowCustomValue && value !== "")
  const showClear = !disabled && hasValue && Boolean(clearLabel)
  // Sin escribir, la lista no se filtra por el valor actual: se ve completa.
  const filterText = allowCustomValue && query === currentText ? "" : query

  const visible = React.useMemo(() => {
    const needle = normalize(filterText.trim())
    if (!needle) return options.slice(0, maxVisible)
    return options
      .filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(needle))
      .slice(0, maxVisible)
  }, [options, filterText, maxVisible])

  const typed = query.trim()
  const customRow: ComboboxOption[] = allowCustomValue && typed && typed !== currentText
    && !options.some((option) => normalize(option.label) === normalize(typed))
    ? [{ value: typed, label: `Usar «${typed}»` }]
    : []
  // La opción de limpiar sólo aparece sin búsqueda: escribiendo, estorba.
  const rows: ComboboxOption[] = clearLabel && !query.trim()
    ? [{ value: "", label: clearLabel }, ...visible]
    : [...customRow, ...visible]

  /**
   * Al abrir, la fila activa es la del valor actual, no la primera: resaltar
   * otra fila hacía creer que esa era la elegida. Sin escribir, la lista no
   * está filtrada, así que el índice sale de `options` (más la fila de limpiar).
   */
  function selectedRowOnOpen(nextQuery: string): number {
    const index = options.slice(0, maxVisible).findIndex((option) => option.value === value)
    if (!hasValue || index < 0) return 0
    return index + (clearLabel && !nextQuery.trim() ? 1 : 0)
  }

  function commit(next: string) {
    onChange(next)
    setQuery("")
    listbox.close()
  }

  const listbox = useComboboxListbox({
    optionCount: rows.length,
    listboxRef,
    disabled,
    onSelect: (index) => {
      if (pristineRef.current) { setQuery(""); listbox.close(); return }
      const row = rows[index]
      if (row) commit(row.value)
    },
  })

  // La fila activa (la elegida al abrir, o la que marcan las flechas) siempre a
  // la vista. Se mueve sólo el scroll del listbox: `scrollIntoView` también
  // desplazaría el diálogo que lo contiene.
  React.useEffect(() => {
    const list = listboxRef.current
    const row = list?.children[listbox.activeIndex] as HTMLElement | undefined
    if (!list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [listbox.open, listbox.activeIndex])

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
          {...listbox.inputAriaProps}
          aria-describedby={rest["aria-describedby"]}
          className={cn(
            // 44px en móvil y compacto desde `sm`, igual que Input/Select: a 32px era el
            // único control de formulario bajo el objetivo táctil de PRODUCT.md.
            "h-11 sm:h-8 w-full rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) pl-7 pr-7 text-base sm:text-sm",
            "text-(--color-text) placeholder:text-(--color-text-subtle)",
            "focus:outline-none focus:border-(--color-primary) focus:ring-2 focus:ring-(--color-primary-line)",
            "disabled:cursor-default disabled:opacity-100",
            "transition-[border-color,box-shadow] duration-(--duration-fast)",
          )}
          placeholder={placeholder}
          aria-label={rest["aria-label"]}
          // Con una selección hecha y el popup cerrado, el input muestra la
          // etiqueta elegida; al abrirlo pasa a ser el campo de búsqueda.
          value={listbox.open ? query : currentText}
          onChange={(event) => {
            pristineRef.current = false
            setQuery(event.target.value)
            listbox.setOpen(true)
            listbox.setActiveIndex(0)
          }}
          onFocus={() => {
            if (disabled) return
            if (allowCustomValue) { setQuery(currentText); pristineRef.current = true }
            listbox.setOpen(true)
            listbox.setActiveIndex(selectedRowOnOpen(allowCustomValue ? currentText : ""))
          }}
          onBlur={(event) => {
            if (!listbox.focusLeft(event)) return
            // Sólo con el popup abierto `query` es lo que el usuario escribió:
            // tras elegir una fila (o Escape) ya no hay nada pendiente que confirmar.
            if (allowCustomValue && listbox.open && query.trim() !== currentText) {
              const match = options.find((option) => normalize(option.label) === normalize(query.trim()))
              onChange(match ? match.value : query.trim())
            }
            setQuery("")
            listbox.close()
          }}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) pristineRef.current = false
            listbox.handleKeyDown(event)
          }}
        />
        {showClear && (
          <button
            type="button"
            aria-label={clearLabel}
            onMouseDown={(event) => { event.preventDefault(); commit("") }}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-(--color-text-subtle) transition-colors duration-(--duration-fast) hover:text-(--color-danger)"
          >
            <X size={12} weight="bold" />
          </button>
        )}
        {!selected && !showClear && (
          <CaretDown
            size={12} weight="bold" aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-(--color-text-subtle)"
          />
        )}
      </div>

      {listbox.open && rows.length > 0 && (
        <ul
          id={listbox.listboxId}
          ref={listboxRef}
          role="listbox"
          className="absolute z-20 top-full mt-1 left-0 right-0 max-h-52 overflow-y-auto rounded-(--radius-xl) bg-(--color-surface) shadow-(--shadow-md) py-1"
        >
          {rows.map((row, index) => (
            <li
              key={customRow.length && index === 0 ? "__custom__" : row.value || "__clear__"}
              id={listbox.optionId(index)}
              role="option"
              aria-selected={row.value === value}
              tabIndex={-1}
              onMouseDown={(event) => { event.preventDefault(); commit(row.value) }}
              onMouseEnter={() => {
                // Pasar el mouse por una fila ya es elegirla como activa: Enter la toma aunque el campo esté «recién enfocado».
                pristineRef.current = false
                listbox.setActiveIndex(index)
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-left transition-colors duration-(--duration-fast)",
                index === listbox.activeIndex
                  ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
                  : "hover:bg-(--color-surface-2)",
              )}
            >
              <span className="text-sm truncate">{row.label}</span>
              {row.hint && <span className="ml-auto shrink-0 text-[11px] text-(--color-text-subtle)">{row.hint}</span>}
              {hasValue && row.value === value && (
                <Check aria-hidden="true" weight="bold" className={cn("size-3.5 shrink-0 text-(--color-primary)", !row.hint && "ml-auto")} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
