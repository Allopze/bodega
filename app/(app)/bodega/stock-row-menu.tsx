"use client"

import Link from "next/link"
import { ArrowsDownUp, ClockCounterClockwise, DotsThree, HandArrowUp, Trash } from "@phosphor-icons/react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { requestBodegaMovement } from "./movement-events"

/** Enlace al kardex de un producto en una faena. Vive aquí para que el menú y
 *  el nombre del producto apunten siempre al mismo destino. */
export function productMovementsHref(productId: string, worksiteId: string): string {
  return `/bodega?vista=kardex&producto=${encodeURIComponent(productId)}&faena=${encodeURIComponent(worksiteId)}`
}

/**
 * Acciones de una fila de Stock. El contexto viaja con la acción: la hoja o la
 * pantalla de destino abren ya con la faena y el producto de la fila, en vez de
 * pedir de nuevo lo que la fila ya sabe.
 */
export function StockRowMenu({
  productId,
  productName,
  worksiteId,
  hasStockRecord,
  canDeliver,
  canAdjust,
}: {
  productId: string
  productName: string
  worksiteId: string
  /** Sin registro de stock no hay saldo que ajustar ni movimientos que ver. */
  hasStockRecord: boolean
  canDeliver: boolean
  canAdjust: boolean
}) {
  // Sin registro de stock y sin permiso de entrega no queda ninguna acción: el
  // botón abría un menú vacío (E2E, 2026-10-05). Mejor no ofrecerlo.
  if (!canDeliver && !hasStockRecord) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Acciones para ${productName}`}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] md:h-8 md:w-8"
        >
          <DotsThree size={20} weight="bold" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canDeliver && (
          <DropdownMenuItem asChild>
            <Link
              href={`/entregas?faena=${encodeURIComponent(worksiteId)}&nueva=1&producto=${encodeURIComponent(productId)}`}
              className="gap-2"
            >
              <HandArrowUp size={15} aria-hidden />
              Entregar
            </Link>
          </DropdownMenuItem>
        )}
        {canAdjust && hasStockRecord && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => requestBodegaMovement({ mode: "adjust", worksiteId, productId })}
          >
            <ArrowsDownUp size={15} aria-hidden />
            Ajustar
          </DropdownMenuItem>
        )}
        {canAdjust && hasStockRecord && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => requestBodegaMovement({ mode: "discard", worksiteId, productId })}
          >
            <Trash size={15} aria-hidden />
            Dar de baja
          </DropdownMenuItem>
        )}
        {hasStockRecord && (
          <DropdownMenuItem asChild>
            <Link href={productMovementsHref(productId, worksiteId)} className="gap-2">
              <ClockCounterClockwise size={15} aria-hidden />
              Ver movimientos
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
