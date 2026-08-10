"use client"

import * as React from "react"
import { CaretDown, Plus } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { OPEN_DELIVERY_FORM_EVENT } from "./delivery-form-trigger"

const STORAGE_KEY = "entregas:form-open"

/**
 * Panel colapsable para el formulario de entrega. Entregas es una estación de
 * captura repetitiva (el bodeguero encadena varias), así que el formulario vive
 * inline y abierto por defecto — pero un usuario que solo consulta el historial
 * puede plegarlo una vez y la preferencia se persiste por navegador. Cuando está
 * plegado, el historial queda inmediatamente bajo la barra del panel.
 */
export function DeliveryFormPanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true)
  const panelRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "closed") setOpen(false)
  }, [])

  React.useEffect(() => {
    function openAndFocus() {
      setOpen(true)
      window.localStorage.setItem(STORAGE_KEY, "open")
      window.requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLElement>("select, input, textarea, button")?.focus()
      })
    }
    window.addEventListener(OPEN_DELIVERY_FORM_EVENT, openAndFocus)
    return () => window.removeEventListener(OPEN_DELIVERY_FORM_EVENT, openAndFocus)
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    window.localStorage.setItem(STORAGE_KEY, next ? "open" : "closed")
  }

  return (
    <section ref={panelRef} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--color-text)">Registrar entrega de EPP</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            Asigna EPP recibido a un trabajador y descuenta el stock de la faena.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={toggle}
          aria-expanded={open}
          className="shrink-0 text-sm text-(--color-text-muted)"
        >
          {open ? (
            <>Ocultar<CaretDown className="h-4 w-4" /></>
          ) : (
            <><Plus className="h-4 w-4" />Registrar entrega</>
          )}
        </Button>
      </div>
      <div className={cn(!open && "hidden")}>{children}</div>
    </section>
  )
}
