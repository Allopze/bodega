"use client"

import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useComboboxListbox } from "@/components/ui/use-combobox-listbox"
import { groupProductsForPicker, type PickerOption } from "./product-picker.helpers"

interface ProductPickerProps {
  products:          PickerOption[]
  onSelectProduct:   (productId: string) => void
  /** Sólo en modo «elegir o texto libre» (sin `freeText`): se llama con lo escrito. */
  onSelectFreeText?: (name: string) => void
  placeholder?:      string
  className?:        string
  /** `id` del campo, para que un `<Field htmlFor>` lo rotule. */
  id?:               string
  /** Nombre accesible de la lista (y del campo si ningún `Field` lo rotula). */
  label?:            string
  /**
   * Texto libre vivo. El texto escrito ES el valor del campo —la descripción del
   * ítem— y el catálogo sólo sugiere: elegir una fila lo reemplaza, ignorarla lo
   * deja como está. Sin esto (EPP) hay que elegir una fila o «Usar “…”».
   *
   * Existe para repuestos, donde el catálogo es opcional: obligar a confirmar el
   * texto como una fila más frenaba a quien pide algo que aún no está catalogado
   * y perdía lo escrito si salía del campo sin confirmar.
   */
  freeText?:         { value: string; onChange: (value: string) => void }
  /**
   * Las opciones ya vienen filtradas por lo escrito (búsqueda en el servidor):
   * se muestran tal cual, sin volver a filtrarlas aquí.
   */
  prefiltered?:      boolean
  /** Una búsqueda en curso: la lista se marca `aria-busy`. */
  busy?:             boolean
  /** Los inyecta `Field`. */
  "aria-labelledby"?:  string
  "aria-describedby"?: string
}

/**
 * Accessible combobox for picking a catalog product or a free-text item.
 *
 * Implements the WAI-ARIA 1.2 combobox pattern:
 *  - `role="combobox"` on the text input with `aria-expanded`, `aria-controls`
 *    and `aria-activedescendant`
 *  - `role="listbox"` on the popup with `aria-labelledby` pointing to the input
 *  - `role="option"` on each choice, with `aria-selected` for the active one
 *  - Keyboard support: ArrowDown/Up (move), Home/End (jump), Enter (select),
 *    Escape (close)
 *
 * Replaces the previous mouse-only implementation that used setTimeout on
 * blur to delay closing the popover, which broke keyboard interactions
 * and was not announced by screen readers.
 */
export function ProductPicker({
  products,
  onSelectProduct,
  onSelectFreeText,
  placeholder = "Buscar en catálogo o escribir producto...",
  className,
  id,
  label = "Buscar producto en catálogo o ingresar ítem libre",
  freeText,
  prefiltered = false,
  busy = false,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: ProductPickerProps) {
  const [ownQuery, setOwnQuery] = React.useState("")
  const query = freeText ? freeText.value : ownQuery
  const labelId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listboxRef = React.useRef<HTMLUListElement>(null)

  const groups = React.useMemo(() => {
    return groupProductsForPicker(products, prefiltered ? "" : query)
  }, [query, products, prefiltered])

  // The "use free text" option sits at the end of the list when the user
  // typed something that didn't match any product. Con `freeText` no existe:
  // lo escrito ya es el valor.
  const hasFreeTextOption = !freeText && query.trim().length > 0 && groups.length === 0
  const totalOptions      = groups.length + (hasFreeTextOption ? 1 : 0)

  // Con texto vivo, recién escrito nada está elegido: la fila activa arranca en
  // -1 y sólo el teclado (o el puntero) la mueve. Si no, Enter —que el usuario
  // pulsa al terminar de escribir— elegiría en silencio la primera sugerencia.
  const initialActiveIndex = freeText ? -1 : 0

  function selectProduct(productId: string) {
    onSelectProduct(productId)
    // Con texto vivo el padre ya reemplazó el texto por el producto: vaciarlo
    // acá lo pisaría y dejaría el ítem sin repuesto.
    if (!freeText) setOwnQuery("")
    listbox.close()
    inputRef.current?.focus()
  }

  function selectFreeText() {
    const trimmed = query.trim()
    if (!trimmed || !onSelectFreeText) return
    onSelectFreeText(trimmed)
    setOwnQuery("")
    listbox.close()
    inputRef.current?.focus()
  }

  // Teclado, apertura y `aria-activedescendant` viven en el hook compartido con
  // `Combobox`: eran la misma implementación duplicada en dos archivos.
  const listbox = useComboboxListbox({
    optionCount: totalOptions,
    listboxRef,
    onSelect: (index) => {
      const variantId = groups[index]?.variants[0]?.id
      if (variantId) selectProduct(variantId)
      else if (hasFreeTextOption && index === groups.length) selectFreeText()
    },
  })
  const { open, listboxId, optionId, activeIndex: safeActiveIndex } = listbox

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (freeText) {
      const noRowActive = safeActiveIndex < 0
      // Cerrada, o sin fila activa, la primera flecha va a la primera (o última)
      // fila: el hook sólo sabe avanzar desde la activa.
      if (totalOptions > 0 && event.key === "ArrowDown" && (!open || noRowActive)) {
        event.preventDefault()
        listbox.setOpen(true)
        listbox.setActiveIndex(0)
        return
      }
      if (totalOptions > 0 && event.key === "ArrowUp" && (!open || noRowActive)) {
        event.preventDefault()
        listbox.setOpen(true)
        listbox.setActiveIndex(totalOptions - 1)
        return
      }
      // Enter sin fila activa es el de quien terminó de escribir: cierra las
      // sugerencias y no elige nada. Sin sugerencias es el Enter de cualquier
      // campo de texto y lo atiende el formulario.
      if (event.key === "Enter" && totalOptions > 0 && open && noRowActive) {
        event.preventDefault()
        listbox.close()
        return
      }
      if (event.key === "Enter" && totalOptions === 0) return
    }
    listbox.handleKeyDown(event)
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <MagnifyingGlass
          size={14}
          weight="bold"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          {...listbox.inputAriaProps}
          // Sin fila activa no hay a quién apuntar (el hook apuntaría a la -1).
          aria-activedescendant={open && totalOptions > 0 && safeActiveIndex >= 0 ? optionId(safeActiveIndex) : undefined}
          aria-labelledby={ariaLabelledBy ?? labelId}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-3 text-sm",
            "text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]",
            "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
            "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
          )}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            if (freeText) freeText.onChange(e.target.value)
            else setOwnQuery(e.target.value)
            listbox.setOpen(true)
            listbox.setActiveIndex(initialActiveIndex)
          }}
          onFocus={() => { listbox.setOpen(true); listbox.setActiveIndex(initialActiveIndex) }}
          onBlur={(event) => { if (listbox.focusLeft(event)) listbox.close() }}
          onKeyDown={handleKeyDown}
        />
        <span id={labelId} className="sr-only">
          {label}
        </span>
      </div>

      {open && totalOptions > 0 && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-labelledby={labelId}
          aria-busy={busy || undefined}
          className={cn(
            "absolute z-20 top-full mt-1 left-0 right-0 max-h-52 overflow-y-auto",
            "rounded-[var(--radius-xl)] bg-[var(--color-surface)]",
            "shadow-[var(--shadow-md)] py-1",
          )}
        >
          {groups.map((group, i) => {
            const first = group.variants[0]
            return (
              <li
                key={group.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === safeActiveIndex}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (first) selectProduct(first.id)
                }}
                // Con texto vivo sólo el teclado mueve la fila activa: un puntero que
                // quedó quieto sobre la lista no puede elegir con el próximo Enter.
                onMouseEnter={() => { if (!freeText) listbox.setActiveIndex(i) }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer text-left",
                  "transition-colors duration-[var(--duration-fast)]",
                  i === safeActiveIndex
                    ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                    : "hover:bg-[var(--color-surface-2)]",
                )}
              >
                <span className="font-mono text-2xs text-[var(--color-text-subtle)] shrink-0">
                  {group.variants.length === 1 ? first?.sku : `${group.variants.length} variantes`}
                </span>
                <span className="min-w-0 flex-1">
                  <span title={group.name} className="block truncate text-sm">{group.name}</span>
                  {first?.detail && (
                    <span title={first.detail} className="block truncate text-2xs text-[var(--color-text-subtle)]">{first.detail}</span>
                  )}
                </span>
                {first?.badge && (
                  <span
                    title={first.badgeTitle ?? undefined}
                    className="shrink-0 rounded-full border border-[var(--color-primary-line)] px-1.5 py-px text-2xs font-medium text-[var(--color-primary-ink)]"
                  >
                    {first.badge}
                  </span>
                )}
              </li>
            )
          })}
          {hasFreeTextOption && (
            <li
              id={optionId(groups.length)}
              role="option"
              aria-selected={safeActiveIndex === groups.length}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); selectFreeText() }}
              onMouseEnter={() => listbox.setActiveIndex(groups.length)}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2 cursor-pointer",
                "border-t border-[var(--color-border)]",
                "transition-colors duration-[var(--duration-fast)]",
                safeActiveIndex === groups.length
                  ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                  : "hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span className="text-sm font-medium">Usar “{query.trim()}”</span>
              <span className="text-2xs text-[var(--color-text-subtle)]">Ítem fuera de catálogo</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
