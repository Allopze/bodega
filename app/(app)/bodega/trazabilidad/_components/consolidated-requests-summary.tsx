"use client"

import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatQty } from "@/lib/utils"
import type { ConsolidatedRequest } from "@/lib/services/trazabilidad-consolidated.types"

interface Props {
  requests: ConsolidatedRequest[]
}

/** Una cifra del flujo de cantidades de la solicitud (TR-F2). */
function FlowStat({ label, value, uom }: { label: string; value: number; uom: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 min-w-0">
      <span className="text-[10px] text-[var(--color-text-muted)] block uppercase">{label}</span>
      <span className="font-mono text-xs font-bold text-slate-800 tabular-nums">
        {formatQty(value, uom)}
      </span>
    </div>
  )
}

/**
 * Vista resumida por solicitud (Task 4 de la migración 2026-09-05).
 *
 * Cada tarjeta es una solicitud navegable a `/solicitudes/<id>` y expone sus
 * órdenes de compra como enlaces a `/compras/<id>`. Con TR-F2 se suma el avance
 * de cantidades (solicitado → en OC → recibido faena → entregado → pendiente)
 * para ver de un vistazo qué le falta a cada solicitud sin bajar a la tabla.
 * Es la unidad principal del seguimiento; los ítems quedan como evidencia en el
 * detalle/expediente.
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

          {/* TR-F2: avance de cantidades por UOM. Si la solicitud usa una sola
              unidad se muestran totales escalares de un vistazo; si mezcla, se
              detalla por UOM sin sumar unidades distintas. */}
          <div className="mt-3 space-y-1.5">
            {request.quantitiesByUom.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] italic">
                Sin cantidades registradas para las líneas de esta solicitud en el alcance filtrado.
              </p>
            ) : (
              request.quantitiesByUom.map((sum) => (
                <div key={sum.uom}>
                  {request.quantitiesByUom.length > 1 && (
                    <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                      {sum.uom}
                    </p>
                  )}
                  <div className="grid grid-cols-5 gap-1.5">
                    <FlowStat label="Solicitado" value={sum.requested} uom={sum.uom} />
                    <FlowStat label="En OC" value={sum.inOc} uom={sum.uom} />
                    <FlowStat label="Rec. faena" value={sum.receivedFaena} uom={sum.uom} />
                    <FlowStat label="Entregado" value={sum.delivered} uom={sum.uom} />
                    <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-2 min-w-0">
                      <span className="text-[10px] text-amber-800 block uppercase">Pendiente</span>
                      <span
                        className={`font-mono text-xs font-bold tabular-nums ${
                          sum.pendingTotal > 0 ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {formatQty(sum.pendingTotal, sum.uom)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
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