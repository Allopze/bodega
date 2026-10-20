import type { Draft } from "./types"

/** Clave de un ítem en el borrador y en los índices de la pantalla. */
export function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

/** Lo que muestra un ítem al que todavía no se le escribió nada. */
export const EMPTY_DRAFT: Draft = { result: "", comment: "", value: "", needsConfirmation: false }

/**
 * I-06: el árbol móvil y el de escritorio coexisten en el DOM —uno oculto por
 * `md:hidden`/`hidden md:*`—, así que sólo uno está realmente visible. Se
 * prueba primero el id móvil y se usa `offsetParent` (null si el elemento o un
 * ancestro tiene `display:none`) para devolver el que esté pintado.
 */
function visibleItemElement(key: string): HTMLElement | null {
  for (const prefix of ["item-mobile-", "item-desktop-"]) {
    const el = document.getElementById(`${prefix}${key}`)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/** Salta al ítem y enfoca su primer control, para dejar a la persona lista para responder. */
export function jumpToItem(key: string) {
  const el = visibleItemElement(key)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.querySelector<HTMLElement>("button, select, input, textarea, [tabindex]")?.focus()
}
