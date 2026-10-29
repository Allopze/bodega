"use client"

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

/**
 * Diálogos y hojas de la app del mecánico. Los tres cuidados que no se negocian:
 * el foco entra al diálogo y queda atrapado, Esc lo cierra, y el fondo queda
 * inerte (`inert`) mientras está abierto. Al cerrarse el foco vuelve a quien lo
 * abrió. Se dibujan en `#mant-modals`, fuera de `#mant-content` (lo inerte).
 */

export const CONTENT_ID = "mant-content"
export const MODALS_ID = "mant-modals"

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let openModals = 0

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

function useModalBehavior(panel: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const content = document.getElementById(CONTENT_ID)
    openModals++
    content?.setAttribute("inert", "")
    const node = panel.current
    if (node) (initialFocus?.current ?? focusables(node)[0] ?? node).focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== "Tab" || !node) return
      const items = focusables(node)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) { event.preventDefault(); node.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      openModals = Math.max(0, openModals - 1)
      if (openModals === 0) content?.removeAttribute("inert")
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  // El panel y el foco inicial se leen una sola vez, al abrir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function Portal({ children }: { children: ReactNode }) {
  const host = typeof document === "undefined" ? null : document.getElementById(MODALS_ID)
  return host ? createPortal(children, host) : null
}

export interface ConfirmDialogProps {
  title: string
  children: ReactNode
  cancelLabel?: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}

/** Pregunta con dos salidas. El foco parte en el botón que NO destruye nada. */
export function ConfirmDialog({ title, children, cancelLabel = "Cancelar", confirmLabel, danger, onCancel, onConfirm, busy }: ConfirmDialogProps) {
  const titleId = useId()
  const textId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useModalBehavior(panel, onCancel, cancel)
  return (
    <Portal>
      <div className="dbg" onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
        <div ref={panel} className="dlg" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1}>
          <h2 id={titleId}>{title}</h2>
          <div id={textId}>{children}</div>
          <div className="dlgb">
            <button ref={cancel} type="button" className="dbtn" onClick={onCancel}>{cancelLabel}</button>
            <button type="button" className={danger ? "dbtn danger" : "dbtn pri"} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export interface SheetProps {
  title: string
  children: ReactNode
  onClose: () => void
  /** Elemento donde cae el foco al abrir; por defecto el primero que se pueda tocar. */
  initialFocus?: RefObject<HTMLElement | null>
}

/** Hoja inferior: para tareas cortas que no justifican cambiar de pantalla. */
export function Sheet({ title, children, onClose, initialFocus }: SheetProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useModalBehavior(panel, onClose, initialFocus)
  return (
    <Portal>
      <div className="sheetbg" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <h2 className="h2" id={titleId} style={{ fontSize: 22 }}>{title}</h2>
          {children}
        </div>
      </div>
    </Portal>
  )
}
