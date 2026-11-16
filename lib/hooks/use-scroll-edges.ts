"use client"

import * as React from "react"

/** Hasta dónde se difumina cada borde, en px. */
const FADE = 28

/**
 * Una fila que se desplaza en horizontal (pestañas en el móvil) tiene que decir que hay más.
 * Cortada en el borde, «Por recibir 3» parecía la última pestaña de las OT (crítica 2026-11-15,
 * paso 7). Este hook:
 *
 * - dice si hay más contenido a la izquierda o a la derecha, y con eso el `style` que difumina
 *   ese borde con una máscara (no un degradado de color: no depende del fondo donde vive la fila);
 * - al montarse, desplaza la fila para que se vea el elemento activo (`aria-current="page"`).
 *
 * Sin desplazamiento (escritorio, pocas pestañas) no hay máscara.
 *
 * `attach` es un callback ref (el setter de un estado), no un `useRef`, y no se llama `ref`: la regla
 * `react-hooks/refs` trata como ref todo lo que se llame así y marcaría leer `style` y `edges` en el
 * render.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [element, attach] = React.useState<T | null>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })

  React.useEffect(() => {
    if (!element) return
    const active = element.querySelector<HTMLElement>('[aria-current="page"]')
    if (active) {
      const left = active.offsetLeft - element.offsetLeft
      const right = left + active.offsetWidth
      if (left < element.scrollLeft || right > element.scrollLeft + element.clientWidth) {
        element.scrollTo({ left: Math.max(0, left - FADE) })
      }
    }
    const update = () => {
      const start = element.scrollLeft > 2
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 2
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    update()
    element.addEventListener("scroll", update, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      element.removeEventListener("scroll", update)
      observer?.disconnect()
    }
  }, [element])

  const mask = edges.start || edges.end
    ? `linear-gradient(to right, ${edges.start ? "transparent" : "black"}, black ${FADE}px, black calc(100% - ${FADE}px), ${edges.end ? "transparent" : "black"})`
    : undefined
  const style: React.CSSProperties | undefined = mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined
  return { attach, edges, style }
}
