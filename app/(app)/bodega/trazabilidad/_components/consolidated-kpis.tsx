"use client"

import {
  FileText,
  Clock,
  Truck,
  Buildings,
  HardHat,
  CheckCircle,
} from "@phosphor-icons/react"
import type { ConsolidatedFaenaKPIs } from "@/lib/services/trazabilidad-consolidated"

interface Props {
  kpis: ConsolidatedFaenaKPIs
}

export function ConsolidatedKpis({ kpis }: Props) {
  const cards = [
    {
      label: "Solicitudes abiertas",
      value: kpis.openRequests,
      icon: FileText,
      color: "text-slate-700",
      bg: "bg-slate-100",
    },
    {
      label: "Pendientes de compra",
      value: kpis.pendingPurchase,
      icon: Clock,
      color: "text-amber-700",
      bg: "bg-amber-50",
      highlight: kpis.pendingPurchase > 0,
    },
    {
      label: "Esperando proveedor",
      value: kpis.awaitingSupplier,
      icon: Truck,
      color: "text-blue-700",
      bg: "bg-blue-50",
    },
    {
      label: "En oficina / central",
      value: kpis.inOffice,
      icon: Buildings,
      color: "text-orange-700",
      bg: "bg-orange-50",
      highlight: kpis.inOffice > 0,
    },
    {
      label: "Disponibles en faena",
      value: kpis.inFaena,
      icon: HardHat,
      color: "text-emerald-700",
      bg: "bg-emerald-50",
    },
    {
      label: "Entrega parcial",
      value: kpis.partiallyDelivered,
      icon: Clock,
      color: "text-purple-700",
      bg: "bg-purple-50",
    },
    {
      label: "Cerrados / entregados",
      value: kpis.fullyDelivered,
      icon: CheckCircle,
      color: "text-emerald-800",
      bg: "bg-emerald-100/60",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7 mb-5">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.label}
            className={`flex flex-col justify-between rounded-xl border bg-white p-3.5 shadow-xs transition-shadow hover:shadow-sm ${
              card.highlight
                ? "border-amber-200/80 bg-amber-50/20"
                : "border-slate-200/70"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 line-clamp-1">
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
      })}
    </div>
  )
}
