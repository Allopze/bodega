"use client"

import {
  FileText,
  Clock,
  Truck,
  CheckCircle,
  Buildings,
  HardHat,
  Package,
} from "@phosphor-icons/react"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
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
    ocPendiente: boolean
  }
  /**
   * Hay filtros aplicados además de la faena. Los KPIs resumen lo filtrado
   * —antes se calculaban sobre la faena completa y contradecían a la tabla—,
   * así que conviene decir sobre qué están contando.
   */
  filtered?: boolean
}

/** Estados de solicitud que componen el KPI "Solicitudes abiertas". */
const OPEN_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "partially_approved",
  "approved",
  "in_purchasing",
] as const

/** Construye un enlace a la bandeja que es dueña de cada KPI. */
function hrefForModule(
  path: string,
  filters: Props["filters"],
  patch: Record<string, string> = {},
) {
  const params = new URLSearchParams()
  if (filters?.faena) params.set("faena", filters.faena)
  for (const [k, v] of Object.entries(patch)) if (v) params.set(k, v)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function ConsolidatedKpis({ kpis, filters, filtered = false }: Props) {
  // UI-01 / A1 (auditoría 2026-09-05): antes eran siete tarjetas no accionables
  // que desplazaban el trabajo fuera de la primera pantalla y violaban el máximo
  // de cuatro tiles accionables. Se mantienen los cuatro que deciden una acción
  // —cada uno enlaza a su vista filtrada— y los secundarios bajan a una tira
  // compacta que no compite por el foco.
  //
  // Los tiles son `KpiCard`, el componente de KPI del producto: la versión
  // artesanal que vivía aquí traía su propio borde, su propia sombra y un chip
  // de icono teñido por métrica (slate/ámbar/azul/esmeralda), colores que la
  // paleta del sistema no define y que hacían que la cabecera de esta pantalla
  // no se pareciera a la de ninguna otra.
  const primaryCards = [
    {
      label: "Solicitudes abiertas",
      value: kpis.openRequests,
      detail: "Ni entregadas, ni canceladas, ni rechazadas",
      icon: <FileText size={14} weight="bold" />,
      href: hrefForModule("/solicitudes", filters, {
        estado: OPEN_REQUEST_STATUSES.join(","),
      }),
    },
    {
      label: "Pendientes de compra",
      value: kpis.pendingPurchase,
      detail: "Con líneas que todavía no tienen OC",
      icon: <Clock size={14} weight="bold" />,
      // El realce naranja es el `tone="signal"` del sistema, y sólo cuando hay
      // algo pendiente de verdad.
      tone: kpis.pendingPurchase > 0 ? ("signal" as const) : ("neutral" as const),
      href: hrefForModule("/compras", filters),
    },
    {
      label: "Esperando proveedor",
      value: kpis.awaitingSupplier,
      // Este KPI cuenta ÓRDENES, no solicitudes como los otros tres: decirlo en
      // el detalle evita leer los cuatro números como la misma unidad.
      detail: "Órdenes de compra emitidas con saldo por recibir",
      icon: <Truck size={14} weight="bold" />,
      // TR-B2 resuelto por TR-F1 (plan 2026-09-05): antes este KPI contaba OCs
      // con saldo por recibir pero enlazaba a `?estado=pedido_proveedor`, que
      // filtra por ESTADO DE ÍTEM, un universo distinto. La tarjeta ahora abre
      // directamente la cola operativa de Recepción, donde se gestionan esas
      // OCs por faena.
      href: hrefForModule("/recepcion", filters),
    },
    {
      label: "Cerrados / entregados",
      value: kpis.fullyDelivered,
      detail: "Solicitudes con la entrega completa",
      icon: <CheckCircle size={14} weight="bold" />,
      href: hrefForModule("/bodega/trazabilidad", filters, { estado: "entregado" }),
    },
  ]

  // Métricas secundarias en la tira del sistema: informan sin repetir el tile
  // accionable ni desplazar el contenido (A1). `SummaryBar` ya atenúa los ceros.
  const secondaryStats: SummaryStat[] = [
    {
      key: "in-office",
      label: "En oficina",
      value: kpis.inOffice,
      icon: <Buildings size={14} aria-hidden />,
    },
    {
      key: "in-faena",
      label: "Disponibles en faena",
      value: kpis.inFaena,
      icon: <HardHat size={14} aria-hidden />,
    },
    {
      key: "partially-delivered",
      label: "Entrega parcial",
      value: kpis.partiallyDelivered,
      icon: <Package size={14} aria-hidden />,
    },
  ]

  return (
    <div className="space-y-3">
      {filtered && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Las métricas resumen los ítems que pasan los filtros aplicados, no la faena completa.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {primaryCards.map((card) => (
          <KpiCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value.toLocaleString("es-CL")}
            detail={card.detail}
            tone={card.tone}
            href={card.href}
          />
        ))}
      </div>

      <SummaryBar stats={secondaryStats} />
    </div>
  )
}
