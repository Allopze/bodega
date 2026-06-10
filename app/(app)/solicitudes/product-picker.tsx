"use client"

import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import type { ProductOption } from "./request-form"

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
  const [query, setQuery]       = React.useState("")
  const [open, setOpen]         = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)

  const inputRef     = React.useRef<HTMLInputElement>(null)
  const listboxRef   = React.useRef<HTMLUListElement>(null)
  const listboxId    = React.useId()
  const labelId      = React.useId()
  const optionId     = (i: number) => `${listboxId}-opt-${i}`

  const filtered = React.useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return products.slice(0, 50)
    const needle = trimmed.toLowerCase()
    return products.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle),
    )
  }, [query, products])

  // The "use free text" option sits at the end of the list when the user
  // typed something that didn't match any product.
  const hasFreeTextOption = query.trim().length > 0 && filtered.length === 0
  const totalOptions      = filtered.length + (hasFreeTextOption ? 1 : 0)

  // Keep activeIndex in range when the result set changes.
  // Derived state — recompute during render instead of firing a setState
  // inside an effect (which would cause a cascading render).
  const safeActiveIndex = activeIndex < totalOptions ? activeIndex : Math.max(0, totalOptions - 1)

  function selectProduct(productId: string) {
    onSelectProduct(productId)
    setQuery("")
    setOpen(false)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  function selectFreeText() {
    const trimmed = query.trim()
    if (!trimmed) return
    onSelectFreeText(trimmed)
    setQuery("")
    setOpen(false)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  function moveActive(delta: number) {
    if (totalOptions === 0) return
    setActiveIndex((current) => {
      const next = (current + delta + totalOptions) % totalOptions
      return next
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!open) setOpen(true)
      moveActive(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) setOpen(true)
      moveActive(-1)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(Math.max(0, totalOptions - 1))
      return
    }
    if (event.key === "Enter") {
      if (!open) return
      event.preventDefault()
      if (filtered[safeActiveIndex]) selectProduct(filtered[safeActiveIndex].id)
      else if (hasFreeTextOption) selectFreeText()
      return
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
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
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && totalOptions > 0 ? optionId(safeActiveIndex) : undefined}
          aria-labelledby={labelId}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-3 text-sm",
            "text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]",
            "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
            "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
          )}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0) }}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            // Close when focus leaves the combobox entirely (the input AND
            // the listbox). We rely on relatedTarget to detect a tab into
            // the listbox instead of a deferred timeout.
            const next = event.relatedTarget as Node | null
            if (next && listboxRef.current?.contains(next)) return
            setOpen(false)
          }}
          onKeyDown={handleKeyDown}
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
            "rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]",
            "shadow-[var(--shadow-md)] py-1",
          )}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === safeActiveIndex}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); selectProduct(p.id) }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-left",
                "transition-colors duration-[var(--duration-fast)]",
                i === safeActiveIndex
                  ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                  : "hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span className="font-mono text-[11px] text-[var(--color-text-subtle)] shrink-0">{p.sku}</span>
              <span className="text-sm truncate">{p.name}</span>
            </li>
          ))}
          {hasFreeTextOption && (
            <li
              id={optionId(filtered.length)}
              role="option"
              aria-selected={safeActiveIndex === filtered.length}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); selectFreeText() }}
              onMouseEnter={() => setActiveIndex(filtered.length)}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2 cursor-pointer",
                "border-t border-[var(--color-border)]",
                "transition-colors duration-[var(--duration-fast)]",
                safeActiveIndex === filtered.length
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
