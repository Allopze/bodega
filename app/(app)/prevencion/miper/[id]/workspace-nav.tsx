"use client"

import { forwardRef, type AnchorHTMLAttributes } from "react"

/**
 * Navegación dentro del espacio de trabajo de la MIPER sin ida al servidor:
 * todo lo que la vista necesita (filas, foto, diccionarios) ya está en el
 * cliente, y un fetch RSC por clic costaba 200–260 ms y reiniciaba las filas.
 * Next sincroniza `pushState`/`replaceState` con `useSearchParams` (doc
 * "Native History API"). Para lo que sí necesita datos nuevos del servidor
 * (crear, duplicar o borrar un riesgo) se sigue usando `router.push`.
 */
export function navigateWorkspace(href: string, mode: "push" | "replace" = "push") {
  if (mode === "replace") {
    window.history.replaceState(null, "", href)
    return
  }
  window.history.pushState(null, "", href)
  // La página scrollea dentro del pozo del shell, no en `window` (STYLING.md).
  document.querySelector<HTMLElement>("[data-shell-scroll]")?.scrollTo({ top: 0 })
}

type WorkspaceLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean }

/** `<a href>` real (clic medio y «abrir en pestaña nueva» siguen funcionando) que navega sin servidor en el clic normal. */
export const WorkspaceLink = forwardRef<HTMLAnchorElement, WorkspaceLinkProps>(function WorkspaceLink({ href, replace = false, onClick, target, download, ...props }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      target={target}
      download={download}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if ((target && target !== "_self") || download !== undefined) return
        event.preventDefault()
        navigateWorkspace(href, replace ? "replace" : "push")
      }}
      {...props}
    />
  )
})
