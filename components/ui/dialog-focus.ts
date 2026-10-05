import * as React from "react"

/**
 * Retorno de foco al cerrar un Dialog o Sheet (WCAG 2.4.3).
 *
 * Radix, al cerrar un diálogo modal, hace `preventDefault` y enfoca
 * `context.triggerRef`. Ese ref sólo existe si el diálogo se abrió con un
 * `DialogTrigger`/`SheetTrigger`; la mayoría de las pantallas lo abren con un
 * botón propio y el estado `open` controlado, así que `triggerRef` es null y el
 * foco caía en `<body>` (medido en TIUX-24: tras Esc, `activeElement` era
 * BODY). Aquí se recuerda el elemento enfocado al abrir —Radix todavía no ha
 * movido el foco cuando dispara `onOpenAutoFocus`— y se le devuelve al cerrar.
 *
 * Respeta al llamador: si su `onCloseAutoFocus` ya hizo `preventDefault`
 * (p. ej. `ConfirmDialog.returnFocusRef`) no se toca nada. Si el elemento ya
 * no está en el DOM o no se puede enfocar, queda el comportamiento de Radix.
 */
export function useReturnFocus(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const previous = React.useRef<HTMLElement | null>(null)

  const handleOpen = React.useCallback((event: Event) => {
    const active = document.activeElement
    previous.current = active instanceof HTMLElement && active !== document.body ? menuTriggerOf(active) ?? active : null
    onOpenAutoFocus?.(event)
  }, [onOpenAutoFocus])

  const handleClose = React.useCallback((event: Event) => {
    onCloseAutoFocus?.(event)
    const target = previous.current
    previous.current = null
    if (event.defaultPrevented || !target || !target.isConnected) return
    event.preventDefault()
    target.focus()
  }, [onCloseAutoFocus])

  return { onOpenAutoFocus: handleOpen, onCloseAutoFocus: handleClose }
}

/**
 * Si el diálogo se abrió desde un ítem de menú ("Más acciones → Corregir
 * estado…"), el ítem desaparece al cerrarse el menú y al cerrar el diálogo ya
 * no hay a quién volver: el foco caía en `<body>`. El menú de Radix rotula su
 * contenido con `aria-labelledby` = id del botón que lo abrió; ése es el
 * destino que el usuario reconoce.
 */
function menuTriggerOf(element: HTMLElement): HTMLElement | null {
  const menu = element.closest<HTMLElement>('[role="menu"]')
  const triggerId = menu?.getAttribute("aria-labelledby")
  const trigger = triggerId ? document.getElementById(triggerId) : null
  return trigger instanceof HTMLElement ? trigger : null
}
