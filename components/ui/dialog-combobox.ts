/**
 * Un combobox del sistema (`Combobox`, `ProductPicker`) dentro de un Dialog o
 * Sheet de Radix. Su lista no es una capa de Radix, así que el diálogo no sabe
 * que existe, y eso rompía dos cosas:
 *
 * - **Autofoco.** Al abrir, Radix enfoca el primer control. Si es un combobox,
 *   su lista se despliega sola (se abre al recibir el foco) y tapa los campos de
 *   abajo y el pie antes de que el usuario haga nada. Ahí el foco va al
 *   contenedor (Radix le pone tabIndex=-1), que además hace que el lector de
 *   pantalla anuncie el título y la descripción.
 * - **Escape.** Radix lo escucha en `document`, en captura, antes que el input:
 *   con la lista abierta, Escape cerraba el diálogo entero —y lo escrito— cuando
 *   sólo se quería cerrar la lista. Ahora la primera Escape cierra la lista y la
 *   segunda el diálogo.
 */

function isOpenCombobox(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.getAttribute("role") === "combobox"
    && target.getAttribute("aria-expanded") === "true"
}

/** Como Radix: un ancestro con `display: none` deja fuera al control. */
function isHidden(element: HTMLElement, container: HTMLElement): boolean {
  if (getComputedStyle(element).visibility === "hidden") return true
  for (let node: HTMLElement | null = element; node && node !== container; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return true
  }
  return false
}

/** El control que el autofoco de Radix elegiría: el primero tabulable y visible. */
function firstTabbable(container: HTMLElement): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const element = node as HTMLElement & { disabled?: boolean; type?: string }
      if (element.disabled || element.hidden || (element.tagName === "INPUT" && element.type === "hidden")) return NodeFilter.FILTER_SKIP
      return element.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isHidden(node as HTMLElement, container)) return node as HTMLElement
  }
  return null
}

/** `onOpenAutoFocus`: si el primer control es un combobox, enfoca el contenedor. */
export function focusContainerBeforeCombobox(event: Event) {
  const container = event.currentTarget
  if (!(container instanceof HTMLElement)) return
  if (firstTabbable(container)?.getAttribute("role") !== "combobox") return
  event.preventDefault()
  container.focus()
}

/**
 * `onEscapeKeyDown`: con la lista de un combobox abierta, Escape es suya.
 * Devuelve `true` si la tomó (el diálogo no se cierra).
 */
export function escapeClosesComboboxFirst(event: KeyboardEvent): boolean {
  if (!isOpenCombobox(event.target)) return false
  event.preventDefault()
  return true
}
