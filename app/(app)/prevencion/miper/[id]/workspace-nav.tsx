"use client"

import { forwardRef, type AnchorHTMLAttributes } from "react"
import { beforeForwardNavigation, shellScroll } from "./workspace-memory"

/**
 * Navegación dentro del espacio de trabajo de la MIPER sin ida al servidor:
 * todo lo que la vista necesita (filas, foto, diccionarios) ya está en el
 * cliente, y un fetch RSC por clic costaba 200–260 ms y reiniciaba las filas.
 * Next sincroniza `pushState`/`replaceState` con `useSearchParams` (doc
 * "Native History API"). Para lo que sí necesita datos nuevos del servidor
 * (crear, duplicar o borrar un riesgo) se sigue usando `router.push`, precedido
 * de `beforeForwardNavigation` igual que aquí.
 */
export function navigateWorkspace(href: string, mode: "push" | "replace" = "push", options: { restoreScroll?: boolean } = {}) {
  // Hacia adelante (push o replace): se recuerda el scroll que se deja y se
  // olvida el del destino. Sólo Atrás/Adelante (y `restoreScroll`) encuentran algo que restaurar.
  beforeForwardNavigation(href, options)
  if (mode === "replace") {
    window.history.replaceState(null, "", href)
    return
  }
  window.history.pushState(null, "", href)
  // La página scrollea dentro del pozo del shell, no en `window` (STYLING.md).
  shellScroll()?.scrollTo({ top: 0 })
}

/**
 * Lleva el pozo hasta `id` cuando la vista que lo contiene ya se pintó: cambiar
 * de pestaña con `replaceState` re-renderiza después, así que el destino
 * aparece uno o dos cuadros más tarde. Deja el foco en su primer botón (el de
 * la tarjeta de la actividad), sin volver a desplazar. Si en `frames` cuadros
 * no aparece, se rinde sin error.
 */
export function scrollToWhenReady(id: string, frames = 30) {
  const tick = (left: number) => {
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ block: "start" })
      target.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
      return
    }
    if (left > 0) requestAnimationFrame(() => tick(left - 1))
  }
  requestAnimationFrame(() => tick(frames))
}

type WorkspaceLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean; restoreScroll?: boolean }

/** `<a href>` real (clic medio y «abrir en pestaña nueva» siguen funcionando) que navega sin servidor en el clic normal. */
export const WorkspaceLink = forwardRef<HTMLAnchorElement, WorkspaceLinkProps>(function WorkspaceLink({ href, replace = false, restoreScroll = false, onClick, target, download, ...props }, ref) {
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
        navigateWorkspace(href, replace ? "replace" : "push", { restoreScroll })
      }}
      {...props}
    />
  )
})
