"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { FieldError } from "./ui"

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
/** Diálogos abiertos, el último arriba: sólo el de arriba atiende el teclado (Esc y Tab). */
const modalStack: symbol[] = []

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

function useModalBehavior(panel: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const content = document.getElementById(CONTENT_ID)
    const self = Symbol("modal")
    modalStack.push(self)
    openModals++
    content?.setAttribute("inert", "")
    const node = panel.current
    if (node) (initialFocus?.current ?? focusables(node)[0] ?? node).focus()

    const onKey = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== self) return
      if (event.key === "Escape") {
        // Un combobox con su lista abierta usa Escape para cerrarla: la hoja se queda (el segundo Escape sí la cierra).
        const focused = document.activeElement
        if (focused instanceof HTMLElement && focused.getAttribute("role") === "combobox" && focused.getAttribute("aria-expanded") === "true") return
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
      const at = modalStack.indexOf(self)
      if (at >= 0) modalStack.splice(at, 1)
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

export interface SaveOrDiscardDialogProps {
  title: string
  children: ReactNode
  saveLabel: string
  keepLabel: string
  discardLabel: string
  onSave: () => void
  /** «Seguir»: cierra el diálogo y deja todo como estaba. También es lo que hacen Esc y tocar fuera. */
  onKeep: () => void
  onDiscard: () => void
  busy?: boolean
  error?: string | undefined
}

/**
 * Salir de algo que se guarda solo: la salida principal CONSERVA el trabajo y el
 * descarte es una acción aparte, abajo y sin relleno (nunca en la posición del
 * botón principal). El foco parte en «Guardar»: lo único que no destruye nada.
 */
export function SaveOrDiscardDialog({ title, children, saveLabel, keepLabel, discardLabel, onSave, onKeep, onDiscard, busy, error }: SaveOrDiscardDialogProps) {
  const titleId = useId()
  const textId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const save = useRef<HTMLButtonElement>(null)
  useModalBehavior(panel, onKeep, save)
  return (
    <Portal>
      <div className="dbg" onClick={(event) => { if (event.target === event.currentTarget) onKeep() }}>
        <div ref={panel} className="dlg" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1}>
          <h2 id={titleId}>{title}</h2>
          <div id={textId}>{children}</div>
          <FieldError message={error} />
          <div className="dlgb stacked">
            <button ref={save} type="button" className="dbtn pri" onClick={onSave} disabled={busy}>{saveLabel}</button>
            <button type="button" className="dbtn" onClick={onKeep} disabled={busy}>{keepLabel}</button>
          </div>
          <div className="dlgd">
            <button type="button" className="dbtn quiet-danger" onClick={onDiscard} disabled={busy}>{discardLabel}</button>
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
  /**
   * Alto fijo (`.sheet-stable`): la hoja no cambia de tamaño cuando su
   * contenido alterna entre vistas, como «Sigue en taller» y «Ya salió».
   * Sin esto la hoja mide su contenido y salta al cambiar la opción.
   */
  stable?: boolean
  /**
   * La hoja tiene algo escrito que se perdería al cerrarla. Con `true`, tocar el
   * fondo, Esc y los botones de cerrar (`useSheetGuard`) preguntan antes de
   * descartar; sin él (o con `false`) cierran directo. Una hoja con formularios
   * adentro puede declararlo desde ellos con `useSheetDirty`.
   */
  dirty?: boolean
}

interface SheetGuard {
  /** Declara si quien llama (identificado por `key`) tiene cambios sin guardar. */
  setDirty: (key: string, dirty: boolean) => void
  /** Corre `action` ya; si hay cambios sin guardar, antes pregunta si se descartan. */
  confirmThen: (action: () => void) => void
}

const SheetGuardContext = createContext<SheetGuard>({ setDirty: () => {}, confirmThen: (action) => action() })

/** Para los botones de cerrar/volver de una hoja: piden confirmar si hay cambios sin guardar. */
export function useSheetGuard(): Pick<SheetGuard, "confirmThen"> {
  const { confirmThen } = useContext(SheetGuardContext)
  return { confirmThen }
}

/** Avisa a la hoja que lo escrito en este formulario todavía no se guarda. Fuera de una hoja no hace nada. */
export function useSheetDirty(dirty: boolean) {
  const key = useId()
  const { setDirty } = useContext(SheetGuardContext)
  useEffect(() => {
    setDirty(key, dirty)
    return () => setDirty(key, false)
  }, [key, dirty, setDirty])
}

/** Hoja inferior: para tareas cortas que no justifican cambiar de pantalla. */
export function Sheet({ title, children, onClose, initialFocus, stable = false, dirty = false }: SheetProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [registered, setRegistered] = useState<ReadonlySet<string>>(() => new Set())
  const [asking, setAsking] = useState(false)
  const pending = useRef<(() => void) | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const isDirty = dirty || registered.size > 0

  const setDirty = useCallback((key: string, value: boolean) => {
    setRegistered((current) => {
      if (current.has(key) === value) return current
      const next = new Set(current)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  const dirtyRef = useRef(isDirty)
  useEffect(() => { dirtyRef.current = isDirty })
  const confirmThen = useCallback((action: () => void) => {
    // Con la pregunta ya abierta no se encadena otra: la responde el diálogo.
    if (pending.current) return
    if (!dirtyRef.current) { action(); return }
    pending.current = action
    trigger.current = document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement) ? document.activeElement : null
    setAsking(true)
  }, [])
  const keepEditing = useCallback(() => {
    pending.current = null
    setAsking(false)
    // La hoja queda inerte mientras se pregunta y el navegador suelta su foco: se devuelve a donde estaba.
    setTimeout(() => { (trigger.current?.isConnected ? trigger.current : panel.current)?.focus({ preventScroll: true }) }, 0)
  }, [])
  const discard = useCallback(() => {
    const action = pending.current
    pending.current = null
    setAsking(false)
    action?.()
  }, [])
  const guard = useMemo(() => ({ setDirty, confirmThen }), [setDirty, confirmThen])
  const requestClose = useCallback(() => confirmThen(onClose), [confirmThen, onClose])

  useModalBehavior(panel, requestClose, initialFocus)
  return (
    <Portal>
      <div className="sheetbg" inert={asking ? true : undefined} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
        <div ref={panel} className={stable ? "sheet sheet-stable" : "sheet"} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <h2 className="h2" id={titleId} style={{ fontSize: 22 }}>{title}</h2>
          <SheetGuardContext.Provider value={guard}>{children}</SheetGuardContext.Provider>
        </div>
      </div>
      {asking ? (
        <ConfirmDialog
          title="¿Descartar lo que escribiste?"
          cancelLabel="Seguir editando"
          confirmLabel="Descartar"
          danger
          onCancel={keepEditing}
          onConfirm={discard}
        >
          <p>Si sales ahora, lo que cambiaste en esta hoja no se guarda.</p>
        </ConfirmDialog>
      ) : null}
    </Portal>
  )
}
