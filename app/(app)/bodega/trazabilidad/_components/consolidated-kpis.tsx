"use client"

import Link from "next/link"
import {
  FileText,
  Clock,
  Truck,
  CheckCircle,
  Buildings,
  HardHat,
  Package,
} from "@phosphor-icons/react"
import type { ConsolidatedFaenaKPIs } from "@/lib/services/trazabilidad-consolidated"

interface Props {
  kpis: ConsolidatedFaenaKPIs
  /** Filtros vigentes para construir los enlaces de cada KPI accionable. */
  filters?: {
    faena: string
    estado: string
    categoria: string
    solicitante: string
    proveedor: string
    q: string
    desde: string
    hasta: string
    pendientes: boolean
  }
  /**
   * Hay filtros aplicados además de la faena. Los KPIs resumen lo filtrado
   * —antes se calculaban sobre la faena completa y contradecían a la tabla—,
   * así que conviene decir sobre qué están contando.
   */
  filtered?: boolean
}

function hrefWith(filters: Props["filters"], patch: Record<string, string>) {
  const params = new URLSearchParams()
  if (filters?.faena) params.set("faena", filters.faena)
  for (const [k, v] of Object.entries(patch)) if (v) params.set(k, v)
  const query = params.toString()
  return query ? `/bodega/trazabilidad?${query}` : "/bodega/trazabilidad"
}

export function ConsolidatedKpis({ kpis, filters, filtered = false }: Props) {
  // UI-01 / A1 (auditoría 2026-09-05): antes eran siete tarjetas no accionables
  // que desplazaban el trabajo fuera de la primera pantalla y violaban el máximo
  // de cuatro tiles accionables. Se mantienen los cuatro que deciden una acción
  // —cada uno enlaza a su vista filtrada— y los secundarios bajan a una fila de
  // texto compacta que no compite por el foco.
  const primaryCards = [
    {
      label: "Solicitudes abiertas",
      value: kpis.openRequests,
      icon: FileText,
      color: "text-slate-700",
      bg: "bg-slate-100",
      href: hrefWith(filters, {}),
    },
    {
      label: "Pendientes de compra",
      value: kpis.pendingPurchase,
      icon: Clock,
      color: "text-amber-700",
      bg: "bg-amber-50",
      highlight: kpis.pendingPurchase > 0,
      href: hrefWith(filters, { pendientes: "true" }),
    },
    {
      label: "Esperando proveedor",
      value: kpis.awaitingSupplier,
      icon: Truck,
      color: "text-blue-700",
      bg: "bg-blue-50",
      // TR-B2 (auditoría 2026-09-05): este KPI cuenta OCs emitidas/enviadas con
      // saldo por recibir (`awaitingSupplier`), pero `?estado=pedido_proveedor`
      // filtra por ESTADO DE ÍTEM ("Pedido a proveedor"), un universo distinto:
      // un ítem con OC parcialmente recibida ya no está en ese estado aunque su
      // OC siga esperando. Hasta que exista un filtro por OC con saldo (TR-F1),
      // el KPI se muestra como informativo, sin enlace, para no llevar a un
      // subconjunto que contradiga el número.
      href: null,
      title:
        "Órdenes de compra emitidas/enviadas con saldo por recibir. No hay filtro por OC aún; se muestra como dato informativo.",
    },
    {
      label: "Cerrados / entregados",
      value: kpis.fullyDelivered,
      icon: CheckCircle,
      color: "text-emerald-800",
      bg: "bg-emerald-100/60",
      href: hrefWith(filters, { estado: "entregado" }),
    },
  ]

  return (
    <div className="mb-4">
      {filtered && (
        <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
          Las métricas resumen los ítems que pasan los filtros aplicados, no la faena completa.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {primaryCards.map((card) => {
          const Icon = card.icon
          const inner = (
            <div
              className={`flex flex-col justify-between rounded-xl border bg-white p-3.5 shadow-xs ${
                card.highlight
                  ? "border-amber-200/80 bg-amber-50/20"
                  : "border-slate-200/70"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[var(--color-text-muted)] line-clamp-1">
                  {card.label}
                </span>
                <span className={`inline-flex p-1 rounded-md ${card.bg} ${card.color}`}>
                  <Icon size={14} weight="bold" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 font-mono">
                {card.value}
              </div>
            </div>
          )
          return card.href ? (
            <Link
              key={card.label}
              href={card.href}
              data-kpi-card
              title={card.title}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]"
            >
              {inner}
            </Link>
          ) : (
            <div key={card.label} data-kpi-card title={card.title}>
              {inner}
            </div>
          )
        })}
      </div>

      {/* Métricas secundarias en fila compacta: informan sin repetir el tile
          accionable ni desplazar el contenido (A1). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <Buildings size={12} aria-hidden /> En oficina: {kpis.inOffice}
        </span>
        <span className="inline-flex items-center gap-1">
          <HardHat size={12} aria-hidden /> Disponibles en faena: {kpis.inFaena}
        </span>
        <span className="inline-flex items-center gap-1">
          <Package size={12} aria-hidden /> Entrega parcial: {kpis.partiallyDelivered}
        </span>
      </div>
    </div>
  )
}
