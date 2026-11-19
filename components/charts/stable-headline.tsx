"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * Zona del titular de un `ChartFrame` (cifra grande + pie). Los gráficos interactivos reescriben
 * ese titular con el balde apuntado, y el texto nuevo puede ocupar otra cantidad de renglones. Si
 * el titular se achica, el gráfico de abajo sube bajo el puntero, el puntero cae en otra columna
 * —o fuera del trazado— y el titular vuelve a cambiar: el gráfico tiembla y el marco cambia de
 * alto. Visto en «Órdenes de trabajo: creadas, cerradas y en cola» del Panel de mantención
 * (2026-11-19): 51 px en reposo y 28 px al apuntar.
 *
 * Mientras el puntero o el foco están dentro del marco (`[data-chart-frame]`), el titular no se
 * achica: conserva el mayor alto que tuvo desde que se entró. Al salir vuelve a su alto natural,
 * así el reposo se ve igual que siempre. No se reserva un alto fijo porque el largo del pie
 * depende de cada gráfico y del ancho de la columna.
 */
export function StableHeadline({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    const frame = outer?.closest<HTMLElement>("[data-chart-frame]")
    if (!outer || !inner || !frame || typeof ResizeObserver === "undefined") return

    let pointerInside = false
    let focusInside = false
    let reserved = 0
    let width = 0

    const update = () => {
      if (!pointerInside && !focusInside) {
        reserved = 0
        width = 0
        outer.style.minHeight = ""
        return
      }
      // `getBoundingClientRect` y no `offsetHeight`: éste redondea al entero y el gráfico igual se corría 1 px.
      const { height, width: currentWidth } = inner.getBoundingClientRect()
      // Otro ancho (se plegó el menú, se giró la pantalla): el alto anterior ya no aplica.
      if (currentWidth !== width) {
        width = currentWidth
        reserved = height
      } else if (height > reserved) {
        reserved = height
      } else {
        return
      }
      outer.style.minHeight = `${reserved}px`
    }

    const onPointerEnter = () => { pointerInside = true; update() }
    const onPointerLeave = () => { pointerInside = false; update() }
    const onFocusIn = () => { focusInside = true; update() }
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && frame.contains(event.relatedTarget)) return
      focusInside = false
      update()
    }

    // Se observa el contenido, no la caja que lleva el `min-height`: así se ve el alto natural del texto.
    const observer = new ResizeObserver(update)
    observer.observe(inner)
    frame.addEventListener("pointerenter", onPointerEnter)
    frame.addEventListener("pointerleave", onPointerLeave)
    frame.addEventListener("focusin", onFocusIn)
    frame.addEventListener("focusout", onFocusOut)
    return () => {
      observer.disconnect()
      frame.removeEventListener("pointerenter", onPointerEnter)
      frame.removeEventListener("pointerleave", onPointerLeave)
      frame.removeEventListener("focusin", onFocusIn)
      frame.removeEventListener("focusout", onFocusOut)
      outer.style.minHeight = ""
    }
  }, [])

  return (
    <div ref={outerRef} data-chart-headline className="mt-3">
      <div ref={innerRef} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">{children}</div>
    </div>
  )
}
