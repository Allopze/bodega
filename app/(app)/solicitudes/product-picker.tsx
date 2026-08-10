"use client"

import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useComboboxListbox } from "@/components/ui/use-combobox-listbox"
import type { ProductOption } from "./request-form.types"
import { groupProductsForPicker } from "./product-picker.helpers"

interface ProductPickerProps {
  products:          ProductOption[]
  onSelectProduct:   (productId: string) => void
  onSelectFreeText:  (name: string) => void
  placeholder?:      string
  className?:        string
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
 *    Escape (close), Tab (commit and leave)
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
}: ProductPickerProps) {
  const [query, setQuery] = React.useState("")
  const labelId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listboxRef = React.useRef<HTMLUListElement>(null)

  const groups = React.useMemo(() => {
    return groupProductsForPicker(products, query)
  }, [query, products])

  // The "use free text" option sits at the end of the list when the user
  // typed something that didn't match any product.
  const hasFreeTextOption = query.trim().length > 0 && groups.length === 0
  const totalOptions      = groups.length + (hasFreeTextOption ? 1 : 0)

  function selectProduct(productId: string) {
    onSelectProduct(productId)
    setQuery("")
    listbox.close()
    inputRef.current?.focus()
  }

  function selectFreeText() {
    const trimmed = query.trim()
    if (!trimmed) return
    onSelectFreeText(trimmed)
    setQuery("")
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
      else if (hasFreeTextOption) selectFreeText()
    },
  })
  const { open, listboxId, optionId, activeIndex: safeActiveIndex } = listbox

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
          type="text"
          {...listbox.inputAriaProps}
          aria-labelledby={labelId}
          className={cn(
            "h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-3 text-sm",
            "text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]",
            "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
            "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
          )}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); listbox.setOpen(true); listbox.setActiveIndex(0) }}
          onFocus={() => listbox.setOpen(true)}
          onBlur={(event) => { if (listbox.focusLeft(event)) listbox.close() }}
          onKeyDown={listbox.handleKeyDown}
        />
        <span id={labelId} className="sr-only">
          Buscar producto en catálogo o ingresar ítem libre
        </span>
      </div>

      {open && totalOptions > 0 && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-labelledby={labelId}
          className={cn(
            "absolute z-20 top-full mt-1 left-0 right-0 max-h-52 overflow-y-auto",
            "rounded-[var(--radius-xl)] bg-[var(--color-surface)]",
            "shadow-[var(--shadow-md)] py-1",
          )}
        >
          {groups.map((group, i) => (
            <li
              key={group.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === safeActiveIndex}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault()
                const variantId = group.variants[0]?.id
                if (variantId) selectProduct(variantId)
              }}
              onMouseEnter={() => listbox.setActiveIndex(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-left",
                "transition-colors duration-[var(--duration-fast)]",
                i === safeActiveIndex
                  ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                  : "hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span className="font-mono text-[11px] text-[var(--color-text-subtle)] shrink-0">
                {group.variants.length === 1 ? group.variants[0]?.sku : `${group.variants.length} variantes`}
              </span>
              <span title={group.name} className="text-sm truncate">{group.name}</span>
            </li>
          ))}
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
              <span className="text-[11px] text-[var(--color-text-subtle)]">Ítem fuera de catálogo</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
