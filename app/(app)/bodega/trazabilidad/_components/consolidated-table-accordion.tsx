"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowSquareOut,
  Clock,
  FileText,
  CheckCircle,
  Truck,
  Buildings,
  HardHat,
} from "@phosphor-icons/react"
import { formatQty, formatDateTime } from "@/lib/utils"
import type { ConsolidatedRow } from "@/lib/services/trazabilidad-consolidated"

interface Props {
  row: ConsolidatedRow
}

/**
 * Cada eslabón enlaza a su propio documento, así que el enlace lo nombra.
 * "Ver documento original" bajo una entrega llevaba al listado completo de
 * entregas, no al comprobante.
 */
const TIMELINE_LINK_LABEL: Partial<Record<ConsolidatedRow["timeline"][number]["type"], string>> = {
  request: "Ver solicitud",
  purchase_order: "Ver orden de compra",
  receipt_office: "Ver recepción",
  receipt_faena: "Ver recepción",
  dispatch_guide: "Ver guía de despacho",
  delivery: "Ver comprobante de entrega",
}

/**
 * Icono por tipo de evento. El tipo se distingue por la FORMA, no por el color:
 * la paleta del producto define el verde para acción/éxito, el naranja sólo
 * para pendientes y el rojo para error, así que teñir siete tipos de evento con
 * siete hues (azul, violeta, cian, índigo…) importaba colores que el sistema no
 * tiene y hacía de esta pantalla la más colorida de la app.
 */
const TIMELINE_ICON: Record<string, React.ComponentType<{ size?: number; weight?: "bold" }>> = {
  request: FileText,
  approval: CheckCircle,
  purchase_order: Truck,
  receipt_office: Buildings,
  dispatch_guide: Truck,
  receipt_faena: HardHat,
  delivery: CheckCircle,
}

export function ConsolidatedTableAccordion({ row }: Props) {
  return (
    <div className="space-y-4">
      {/* 1. Desglose de etapas y pendientes */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Etapa de las cantidades
          </h4>
          <div className="text-xs text-[var(--color-text-muted)]">
            {row.deliveryMode === "directo_faena" ? "Envío directo a faena" : "Despacho vía oficina central"}
          </div>
        </div>

        {/* Las etapas intermedias sólo dicen DÓNDE está la cantidad, no que algo
            vaya mal: van en neutro. El color queda para lo que exige una
            lectura —el saldo que falta del proveedor, en naranja `signal`— y
            para el cierre del flujo —lo entregado, en verde `success`. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Solicitado */}
          <div className="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface-2)]">
            <span className="text-[11px] text-[var(--color-text-muted)] block">Solicitado</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">
              {formatQty(row.requested, row.uom)}
            </span>
          </div>

          {/* En OC / Proveedor */}
          <div className="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface-2)]">
            <span className="text-[11px] text-[var(--color-text-muted)] block">En OC con proveedor</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">
              {formatQty(row.inOc, row.uom)}
            </span>
            {row.pendingBreakdown.pendingFromSupplier > 0 && (
              <span className="block text-[10px] text-[var(--color-signal-ink)] font-medium mt-0.5">
                Faltan {formatQty(row.pendingBreakdown.pendingFromSupplier, row.uom)}
              </span>
            )}
          </div>

          {/* En oficina */}
          <div className="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface-2)]">
            <span className="text-[11px] text-[var(--color-text-muted)] block">En oficina central</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">
              {formatQty(row.pendingBreakdown.inOffice, row.uom)}
            </span>
            <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Recib: {formatQty(row.receivedOffice)} · Desp: {formatQty(row.dispatched)}
            </span>
          </div>

          {/* En tránsito */}
          <div className="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface-2)]">
            <span className="text-[11px] text-[var(--color-text-muted)] block">En camino a faena</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">
              {formatQty(row.pendingBreakdown.inTransit, row.uom)}
            </span>
            <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Despachado vía GDI
            </span>
          </div>

          {/* En faena sin entregar */}
          <div className="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface-2)]">
            <span className="text-[11px] text-[var(--color-text-muted)] block">En faena (por entregar)</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">
              {formatQty(row.pendingBreakdown.inFaenaAvailable, row.uom)}
            </span>
            <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Recibido en faena
            </span>
          </div>

          {/* Entregado a usuario */}
          <div className="border border-[var(--color-success-line)] rounded-lg p-2.5 bg-[var(--color-success-tint)]">
            <span className="text-[11px] text-[var(--color-success-ink)] font-medium block">Entregado a usuario</span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-success-ink)]">
              {formatQty(row.delivered, row.uom)}
            </span>
            <span className="block text-[10px] text-[var(--color-success-ink)] mt-0.5">
              Con comprobante
            </span>
          </div>
        </div>
      </div>

      {/* 2. Historial cronológico (Timeline) */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Trazabilidad cronológica de movimientos
          </h4>
          <Link
            href={`/bodega/trazabilidad/${row.itemId}`}
            className="text-xs text-[var(--color-primary)] font-semibold hover:underline inline-flex items-center gap-1"
          >
            Ver expediente completo
            <ArrowSquareOut size={12} />
          </Link>
        </div>

        {row.timeline.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] italic">
            No hay movimientos registrados para este ítem.
          </p>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--color-border)]">
            {row.timeline.map((event) => {
              const Icon = TIMELINE_ICON[event.type] ?? Clock

              // La entrega es el cierre del flujo y lo único que el color
              // necesita destacar; un movimiento anulado se muestra apagado y
              // tachado, porque sacarlo del historial escondería justo lo que
              // hay que auditar.
              const iconTone = event.voided
                ? "bg-[var(--color-surface-3)] text-[var(--color-text-subtle)]"
                : event.type === "delivery"
                ? "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]"
                : "bg-[var(--color-surface-3)] text-[var(--color-text-muted)]"

              return (
                <div
                  key={event.id}
                  className={`relative flex items-start gap-3 text-xs ${event.voided ? "opacity-70" : ""}`}
                >
                  <span
                    className={`absolute -left-6 top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-[var(--color-surface)] ${iconTone}`}
                  >
                    <Icon size={11} weight="bold" />
                  </span>
                  <div className="flex-1 min-w-0 bg-[var(--color-surface-2)] p-2.5 rounded-lg border border-[var(--color-border)]">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className={`font-bold text-[var(--color-text)] ${event.voided ? "line-through" : ""}`}>
                        {event.title}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
                        {formatDateTime(event.date)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[var(--color-text-muted)]">{event.description}</p>
                    {event.href && (
                      <div className="mt-1">
                        <Link
                          href={event.href}
                          className="text-[11px] text-[var(--color-primary)] hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          {TIMELINE_LINK_LABEL[event.type] ?? "Ver documento original"}
                          <ArrowSquareOut size={11} />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
