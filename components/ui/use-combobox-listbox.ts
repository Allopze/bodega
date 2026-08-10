"use client"

import * as React from "react"

/**
 * Mecánica compartida del patrón combobox de WAI-ARIA 1.2: apertura, opción
 * activa, ids para `aria-controls`/`aria-activedescendant` y el teclado
 * (ArrowUp/Down, Home/End, Enter, Escape, blur fuera del listbox).
 *
 * Existe porque había dos implementaciones del mismo teclado —`ProductPicker` y
 * `Combobox`— y arreglar una dejaba la otra atrás. Cada componente sigue
 * dibujando sus propias filas y siendo dueño de su texto de búsqueda (del que
 * dependen las filas, y por tanto `optionCount`): lo único que se comparte es
 * el comportamiento.
 */
export function useComboboxListbox({
  optionCount,
  onSelect,
  listboxRef,
  disabled = false,
}: {
  /** Cuántas filas hay en el listbox ahora mismo. */
  optionCount: number
  /** Se llama con el índice elegido (Enter). */
  onSelect: (index: number) => void
  /**
   * Ref del `<ul role="listbox">`, para saber si el foco salió del combobox.
   * Lo declara el componente y no el hook: devolver refs desde un hook y
   * pasarlas por `ref={hook.algo}` es un acceso a ref durante el render, que
   * el lint de React rechaza.
   */
  listboxRef: React.RefObject<HTMLUListElement | null>
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)

  const listboxId = React.useId()
  const optionId = React.useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId])

  // Estado derivado: cuando el filtro achica la lista, el índice activo se
  // recorta en el render en vez de disparar un setState en un efecto (que
  // provocaría un render en cascada).
  const safeActiveIndex = activeIndex < optionCount ? activeIndex : Math.max(0, optionCount - 1)

  const close = React.useCallback(() => {
    setOpen(false)
    setActiveIndex(0)
  }, [])

  function moveActive(delta: number) {
    if (optionCount === 0) return
    setActiveIndex((current) => {
      const from = current < optionCount ? current : Math.max(0, optionCount - 1)
      return (from + delta + optionCount) % optionCount
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) setOpen(true)
      moveActive(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); return }
    if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(0, optionCount - 1)); return }
    if (event.key === "Enter") {
      if (!open) return
      event.preventDefault()
      if (optionCount > 0) onSelect(safeActiveIndex)
      return
    }
    if (event.key === "Escape" && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  /**
   * ¿El foco salió del combobox entero (input + listbox)? Se mira
   * `relatedTarget` en vez de diferir el cierre con un timeout, que era lo que
   * rompía la navegación por teclado.
   */
  const focusLeft = React.useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null
    return !(next && listboxRef.current?.contains(next))
  }, [listboxRef])

  return {
    open, setOpen,
    activeIndex: safeActiveIndex, setActiveIndex,
    listboxId, optionId,
    handleKeyDown, focusLeft, close,
    /** Props de accesibilidad comunes al `<input role="combobox">`. */
    inputAriaProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": listboxId,
      "aria-activedescendant": open && optionCount > 0 ? optionId(safeActiveIndex) : undefined,
      autoComplete: "off" as const,
      spellCheck: false,
      disabled,
    },
  }
}
