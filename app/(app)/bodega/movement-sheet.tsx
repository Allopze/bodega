"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ClipboardText, ArrowsDownUp, Plus, CaretRight, CaretLeft,
  Trash, Truck, Spinner, Warning, HandArrowUp, Package,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { AdjustPanel } from "./adjust-panel"
import { DiscardPanel } from "./discard-panel"
import { PhysicalInventoryPanel } from "./physical-inventory-panel"
import type { BodegaOptions } from "./movement-options"
import {
  BODEGA_MOVEMENT_EVENT, requestBodegaMovement,
  type BodegaMovementMode, type BodegaMovementRequest,
} from "./movement-events"

type WorksiteOption = { id: string; name: string }

/** Lo pendiente que la hoja muestra en "Recibir guía u OC". */
export interface ReceivePending {
  guidesToConfirm: number
  ordersToReceive: number
}

/**
 * Botón del encabezado. Sólo avisa: la hoja vive en la página, una sola vez
 * (ver `movement-events.ts`).
 */
export function BodegaMovementTrigger() {
  return (
    <Button size="sm" onClick={() => requestBodegaMovement()}>
      <Plus className="mr-1.5 h-4 w-4" />
      Registrar movimiento
    </Button>
  )
}

const ROW_CLASS =
  "group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint)"
const ICON_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)"

/**
 * Hoja "Registrar movimiento", ordenada por los trabajos del bodeguero y no por
 * el nombre del documento que generan: entregar, recibir, dar de baja, ajustar,
 * contar.
 *
 * Entregar y recibir no se registran aquí —tienen su pantalla— pero son lo que
 * más se hace en una bodega, así que la hoja los ofrece y lleva allí con la
 * faena ya elegida. Baja, ajuste y conteo sí se hacen en la hoja: primero
 * pregunta *qué*, después *en qué faena* (ya preseleccionada con la de la
 * página) y sólo entonces carga las opciones desde `/api/bodega/opciones`.
 *
 * "Devolución a stock" se retiró (2026-10): exigía entregas "a faena" y el único
 * creador de entregas escribe "a trabajador", así que nunca tenía qué ofrecer.
 * Las devoluciones ya registradas siguen legibles en Movimientos y Documentos.
 */
export function BodegaMovementSheet({
  worksites,
  currentWorksiteId,
  canAdjust,
  canDeliver,
  canReceive,
  canViewGuides,
  canCreateGuide = false,
  pending,
  initialRequest,
}: {
  worksites: WorksiteOption[]
  /** Faena a la vista en la página (`""` = todas): con la que arranca la hoja. */
  currentWorksiteId: string
  canAdjust: boolean
  canDeliver: boolean
  canReceive: boolean
  canViewGuides: boolean
  canCreateGuide?: boolean
  pending: ReceivePending
  /** Apertura pedida por la URL (`?nuevo=conteo&faena=…`). */
  initialRequest?: BodegaMovementRequest
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState<BodegaMovementMode | null>(null)
  const [worksiteId, setWorksiteId] = React.useState<string>(currentWorksiteId)
  const [productId, setProductId] = React.useState<string | undefined>(undefined)
  const [options, setOptions] = React.useState<BodegaOptions | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // La faena a la vista se lee al abrir, no al renderizar: el ref se actualiza
  // en un efecto (escribirlo durante el render lo prohíbe react-hooks/refs).
  const currentRef = React.useRef(currentWorksiteId)
  React.useEffect(() => {
    currentRef.current = currentWorksiteId
  }, [currentWorksiteId])

  const openWith = React.useCallback((request: BodegaMovementRequest) => {
    setType(request.mode ?? null)
    setWorksiteId(request.worksiteId ?? currentRef.current)
    setProductId(request.productId)
    setOptions(null)
    setError(null)
    setOpen(true)
  }, [])

  React.useEffect(() => {
    const onRequest = (event: Event) => openWith((event as CustomEvent<BodegaMovementRequest>).detail ?? {})
    window.addEventListener(BODEGA_MOVEMENT_EVENT, onRequest)
    return () => window.removeEventListener(BODEGA_MOVEMENT_EVENT, onRequest)
  }, [openWith])

  // Apertura desde un enlace (el aviso "Conteos en borrador"). Se consume una
  // vez y se quita de la URL para que recargar no la vuelva a abrir.
  const consumedInitial = React.useRef(false)
  React.useEffect(() => {
    if (consumedInitial.current || !initialRequest?.mode) return
    consumedInitial.current = true
    openWith(initialRequest)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("nuevo")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [initialRequest, openWith, pathname, router, searchParams])

  type Choice = { key: BodegaMovementMode; label: string; desc: string; icon: React.ReactNode }
  const adjustChoices: Choice[] = canAdjust
    ? [
        { key: "discard", label: "Baja o merma", desc: "Se dañó, venció o se perdió. Sale del stock con folio propio.", icon: <Trash size={18} /> },
        { key: "adjust", label: "Ajuste", desc: "El número del sistema no cuadra con lo que hay en la estantería.", icon: <ArrowsDownUp size={18} /> },
        { key: "count", label: "Conteo físico", desc: "Cuenta la estantería y, antes de cerrar, revisa un resumen de los ajustes.", icon: <ClipboardText size={18} /> },
      ]
    : []

  const needsOptions = type !== null

  React.useEffect(() => {
    if (!needsOptions || !worksiteId) {
      setOptions(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/bodega/opciones?faena=${encodeURIComponent(worksiteId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? "No se pudieron cargar las opciones")
        return body as BodegaOptions
      })
      .then((data) => { if (!cancelled) setOptions(data) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar las opciones")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [needsOptions, worksiteId])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) window.setTimeout(() => { setType(null); setProductId(undefined); setOptions(null); setError(null) }, 200)
  }

  // Al registrar, la hoja se cierra y la próxima apertura vuelve a pedir las
  // opciones: las cantidades de stock cambiaron.
  const closeSheet = () => handleOpenChange(false)

  const scopeName = worksites.find((worksite) => worksite.id === currentWorksiteId)?.name
  const deliverHref = currentWorksiteId
    ? `/entregas?faena=${encodeURIComponent(currentWorksiteId)}&nueva=1`
    : "/entregas?nueva=1"
  const guidesHref = currentWorksiteId
    ? `/bodega/guias?estado=dispatched&faena=${encodeURIComponent(currentWorksiteId)}`
    : "/bodega/guias?estado=dispatched&faena=todas"

  const hasReceive = (canViewGuides || canReceive)
  if (!canDeliver && !hasReceive && adjustChoices.length === 0 && !canCreateGuide) return null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>Registrar movimiento</SheetTitle>
            {type === null && (
              <SheetDescription>
                {scopeName ? `¿Qué hiciste en ${scopeName}?` : "¿Qué necesitas hacer en la bodega?"}
              </SheetDescription>
            )}
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <SheetBody>
          {type === null ? (
            <div className="flex flex-col gap-2">
              {canDeliver && (
                <Link href={deliverHref} className={ROW_CLASS}>
                  <span className={ICON_CLASS}><HandArrowUp size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-(--color-text)">Entregar a trabajador</span>
                    <span className="block text-xs text-(--color-text-muted)">
                      Entrega EPP o productos de la bodega a una persona.
                    </span>
                  </span>
                  <CaretRight size={16} className="shrink-0 text-(--color-text-faint)" />
                </Link>
              )}

              {hasReceive && (
                <div className="flex items-start gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted)">
                    <Package size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-(--color-text)">Recibir guía u OC</span>
                    <span className="block text-xs text-(--color-text-muted)">
                      Lo que llega a la bodega se confirma contra su documento.
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2">
                      {canViewGuides && (
                        <Link
                          href={guidesHref}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-(--radius) border border-(--color-border) px-3 text-xs font-medium text-(--color-text) hover:border-(--color-primary) hover:bg-(--color-primary-tint) sm:min-h-8"
                        >
                          <span className="font-mono font-semibold tabular-nums">{pending.guidesToConfirm}</span>
                          {pending.guidesToConfirm === 1 ? "guía por confirmar" : "guías por confirmar"}
                        </Link>
                      )}
                      {canReceive && (
                        <Link
                          href="/recepcion"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-(--radius) border border-(--color-border) px-3 text-xs font-medium text-(--color-text) hover:border-(--color-primary) hover:bg-(--color-primary-tint) sm:min-h-8"
                        >
                          <span className="font-mono font-semibold tabular-nums">{pending.ordersToReceive}</span>
                          OC por recibir
                        </Link>
                      )}
                    </span>
                  </span>
                </div>
              )}

              {adjustChoices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => { setType(choice.key); setProductId(undefined) }}
                  className={ROW_CLASS}
                >
                  <span className={ICON_CLASS}>{choice.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-(--color-text)">{choice.label}</span>
                    <span className="block text-xs text-(--color-text-muted)">{choice.desc}</span>
                  </span>
                  <CaretRight size={16} className="shrink-0 text-(--color-text-faint)" />
                </button>
              ))}

              {/* Un traslado a faena se emite como guía de despacho, y esas
                  nacen de una recepción en oficina — no hay formulario suelto
                  a propósito. Sin esta fila, "¿dónde muevo stock a faena?" no
                  tiene respuesta en la pantalla donde se pregunta. Va al final:
                  es informativa, no una acción de la hoja. */}
              {canCreateGuide && (
                <Link
                  href="/recepcion"
                  className={`${ROW_CLASS} border-dashed`}
                >
                  <span className={ICON_CLASS}><Truck size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-(--color-text)">Traslado a faena</span>
                    <span className="block text-xs text-(--color-text-muted)">
                      Se emite como guía de despacho desde la recepción en oficina.
                    </span>
                  </span>
                  <CaretRight size={16} className="shrink-0 text-(--color-text-faint)" />
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => { setType(null); setProductId(undefined) }}
                className="inline-flex min-h-11 items-center gap-1 self-start text-xs font-medium text-(--color-text-muted) hover:text-(--color-text) sm:min-h-6"
              >
                <CaretLeft size={14} />Elegir otra tarea
              </button>

              <Field label="Faena" htmlFor="movementWorksiteId" required>
                <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setProductId(undefined) }}>
                  <SelectTrigger id="movementWorksiteId">
                    <SelectValue placeholder="Selecciona faena" />
                  </SelectTrigger>
                  <SelectContent>
                    {worksites.map((worksite) => (
                      <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {!worksiteId && (
                <p className="text-xs text-(--color-text-muted)">
                  Elige la faena para cargar sus productos.
                </p>
              )}

              {loading && (
                <p className="flex items-center gap-2 text-xs text-(--color-text-muted)">
                  <Spinner size={14} className="animate-spin" aria-hidden />
                  Cargando productos de la faena...
                </p>
              )}

              {error && (
                <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
                  <Warning size={14} aria-hidden /> {error}
                </p>
              )}

              {options && !loading && (
                <>
                  {type === "count" && (
                    <PhysicalInventoryPanel key={options.worksiteId} worksiteId={options.worksiteId} products={options.products} draft={options.openCount} onDone={closeSheet} />
                  )}
                  {type === "adjust" && (
                    <AdjustPanel key={options.worksiteId} worksiteId={options.worksiteId} products={options.products} initialProductId={productId} onDone={closeSheet} />
                  )}
                  {type === "discard" && (
                    <DiscardPanel key={options.worksiteId} worksiteId={options.worksiteId} products={options.products} initialProductId={productId} onDone={closeSheet} />
                  )}
                </>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
