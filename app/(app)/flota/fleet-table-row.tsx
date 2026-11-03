"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { TableRow } from "@/components/ui/table"

/**
 * Un enlace o botón DENTRO de la fila (p. ej. «Lectura objetada» en la columna Km/Hr) actúa por sí solo:
 * ni su clic ni su Enter/Espacio abren la ficha del equipo. Sin esto el Enter burbujeaba a la fila, que lo
 * cancelaba (`preventDefault`) y navegaba a la ficha: el enlace no se podía activar con teclado.
 */
function fromInnerControl(event: { target: EventTarget; currentTarget: Element }): boolean {
  if (!(event.target instanceof Element) || event.target === event.currentTarget) return false
  const control = event.target.closest("a, button")
  return control !== null && event.currentTarget.contains(control)
}

export function FleetTableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter()

  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if (fromInnerControl(event)) return
        router.push(href)
      }}
      onKeyDown={(event) => {
        if (fromInnerControl(event)) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          router.push(href)
        }
      }}
      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
    >
      {children}
    </TableRow>
  )
}
