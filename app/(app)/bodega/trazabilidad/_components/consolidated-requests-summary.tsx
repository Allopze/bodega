"use client"

import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import type { ConsolidatedRequest } from "@/lib/services/trazabilidad-consolidated.types"

interface Props {
  requests: ConsolidatedRequest[]
}

/**
 * Vista resumida por solicitud (Task 4 de la migración 2026-09-05).
 *
 * Cada tarjeta es una solicitud navegable a `/solicitudes/<id>` y expone sus
 * órdenes de compra como enlaces a `/compras/<id>`. Es la unidad principal del
 * seguimiento: los ítems siguen como evidencia en la tabla/detalle de debajo.
 */
export function ConsolidatedRequestsSummary({ requests }: Props) {
  return (
    <section
      aria-label="Solicitudes de compra"
      className="mb-4 space-y-3"
    >
      {requests.map((request) => (
        <article
          key={request.requestId}
          className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/solicitudes/${request.requestId}`}
                  className="font-mono text-sm font-bold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                >
                  {request.requestCode}
                  <ArrowSquareOut size={12} className="shrink-0" aria-hidden />
                </Link>
                <Badge variant={request.statusColor} size="sm">
                  {request.statusLabel}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {request.requesterName} · {formatDate(request.requestDate)} ·{" "}
                {request.lineCount} {request.lineCount === 1 ? "línea" : "líneas"} ·{" "}
                {request.orderCount} {request.orderCount === 1 ? "OC" : "OCs"}
              </p>
            </div>

            {request.alert && (
              <span className="rounded-[var(--radius-full)] bg-[var(--color-signal-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-signal-ink)]">
                Tiene pendientes de compra
              </span>
            )}
          </div>

          {request.orders.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
              {request.orders.map((order) => (
                <Link
                  key={order.orderId}
                  href={`/compras/${order.orderId}`}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-text)] hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary-ink)]"
                >
                  {order.code}
                  <ArrowSquareOut size={11} aria-hidden />
                </Link>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  )
}