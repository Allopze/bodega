"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowBendUpLeft, ClipboardText, ArrowsDownUp, Plus, CaretRight, CaretLeft,
  Trash, Gauge, Truck, Spinner, Warning,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { ReturnPanel } from "./return-panel"
import { AdjustPanel } from "./adjust-panel"
import { DiscardPanel } from "./discard-panel"
import { PhysicalInventoryPanel } from "./physical-inventory-panel"
import { MinStockPanel } from "./min-stock-panel"
import type { BodegaOptions } from "./movement-options"

type WorksiteOption = { id: string; name: string }
type MovementType = "return" | "count" | "adjust" | "discard" | "minstock"

/**
 * Punto de entrada único para los movimientos de bodega.
 *
 * Primero pregunta *qué* movimiento, después *en qué faena*, y sólo entonces
 * carga las opciones de esa faena desde `/api/bodega/opciones`. Antes las tres
 * listas se calculaban en el render de la página — incluido un producto
 * cartesiano faenas × productos — aunque el panel no llegara a abrirse.
 */
export function BodegaMovementSheet({
  worksites,
  canRegister,
  canAdjust,
  canCreateGuide = false,
}: {
  worksites: WorksiteOption[]
  canRegister: boolean
  canAdjust: boolean
  canCreateGuide?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState<MovementType | null>(null)
  const [worksiteId, setWorksiteId] = React.useState<string>("")
  const [options, setOptions] = React.useState<BodegaOptions | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  type Choice = { key: MovementType; label: string; desc: string; icon: React.ReactNode }
  const choices: Choice[] = [
    ...(canRegister ? [{ key: "return" as const, label: "Devolución a stock", desc: "Reingresar EPP no utilizado a la faena.", icon: <ArrowBendUpLeft size={18} /> }] : []),
    ...(canAdjust ? [{ key: "count" as const, label: "Conteo físico", desc: "Cerrar un conteo con ajuste automático por diferencia.", icon: <ClipboardText size={18} /> }] : []),
    ...(canAdjust ? [{ key: "adjust" as const, label: "Ajuste de inventario", desc: "Corregir una existencia con motivo.", icon: <ArrowsDownUp size={18} /> }] : []),
    ...(canAdjust ? [{ key: "discard" as const, label: "Baja por desecho", desc: "Retirar EPP dañado o vencido, con folio propio.", icon: <Trash size={18} /> }] : []),
    ...(canRegister ? [{ key: "minstock" as const, label: "Definir stock mínimo", desc: "Fijar umbrales de toda una faena de una vez.", icon: <Gauge size={18} /> }] : []),
  ]

  const needsOptions = type !== null
  const chosenWorksite = worksites.find((item) => item.id === worksiteId)

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
    if (!next) window.setTimeout(() => { setType(null); setWorksiteId(""); setOptions(null); setError(null) }, 200)
  }

  // Al registrar, la hoja se cierra y la próxima apertura vuelve a pedir las
  // opciones: las cantidades de stock y las devoluciones pendientes cambiaron.
  const closeSheet = () => handleOpenChange(false)

  if (choices.length === 0 && !canCreateGuide) return null

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Registrar movimiento
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Registrar movimiento</SheetTitle>
              {type === null && <SheetDescription>Elige el tipo de movimiento a registrar.</SheetDescription>}
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {type === null ? (
              <div className="flex flex-col gap-2">
                {choices.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    onClick={() => setType(choice.key)}
                    className="group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint)"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
                      {choice.icon}
                    </span>
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
                    tiene respuesta en la pantalla donde se pregunta. */}
                {canCreateGuide && (
                  <Link
                    href="/recepcion"
                    className="group flex items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint)"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
                      <Truck size={18} />
                    </span>
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
                  onClick={() => { setType(null); setWorksiteId("") }}
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-(--color-text-muted) hover:text-(--color-text)"
                >
                  <CaretLeft size={14} />Elegir otro tipo
                </button>

                <Field label="Faena" htmlFor="movementWorksiteId" required>
                  <Select value={worksiteId} onValueChange={setWorksiteId}>
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
                    {type === "return" && (
                      <ReturnPanel worksiteId={options.worksiteId} returns={options.returns} onDone={closeSheet} />
                    )}
                    {type === "count" && (
                      <PhysicalInventoryPanel worksiteId={options.worksiteId} products={options.products} draft={options.openCount} onDone={closeSheet} />
                    )}
                    {type === "adjust" && (
                      <AdjustPanel worksiteId={options.worksiteId} products={options.products} onDone={closeSheet} />
                    )}
                    {type === "discard" && (
                      <DiscardPanel worksiteId={options.worksiteId} products={options.products} onDone={closeSheet} />
                    )}
                    {type === "minstock" && (
                      <MinStockPanel
                        worksiteId={options.worksiteId}
                        worksiteName={chosenWorksite?.name ?? options.worksiteName}
                        products={options.products}
                        onDone={closeSheet}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
