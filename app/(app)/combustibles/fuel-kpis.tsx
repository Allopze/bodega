"use client"

import { KpiCard } from "@/components/ui/kpi-card"
import { GasPump, CurrencyCircleDollar, Hash, Gauge } from "@phosphor-icons/react"
import { formatCLP } from "@/lib/utils"

interface FuelDashboardKpisProps {
  totalLiters: number
  totalAmount: number
  loadCount: number
  /** Rango de período representado (p. ej. "2026-01 — 2026-05"). */
  periodLabel: string
}

const NUM_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const formatNum = (n: number) => NUM_FORMAT.format(n)

export function FuelDashboardKpis({ totalLiters, totalAmount, loadCount, periodLabel }: FuelDashboardKpisProps) {
  const avgPricePerLiter = totalLiters > 0 ? totalAmount / totalLiters : 0

  return (
    <section className="mb-6" aria-label="Resumen de combustible">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Resumen</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          Período: <span className="font-mono text-[var(--color-text)]">{periodLabel}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
        <KpiCard
          icon={<Hash size={18} weight="bold" />}
          label="Cargas"
          value={formatNum(loadCount)}
          detail="Cargas registradas"
        />
        <KpiCard
          icon={<GasPump size={18} weight="bold" />}
          label="Litros totales"
          value={`${formatNum(totalLiters)} L`}
          detail="Combustible cargado"
        />
        <KpiCard
          icon={<CurrencyCircleDollar size={18} weight="bold" />}
          label="Total gastado"
          value={formatCLP(totalAmount)}
          detail="Gasto del período"
        />
        <KpiCard
          icon={<Gauge size={18} weight="bold" />}
          label="Precio promedio"
          value={`${formatCLP(avgPricePerLiter)}/L`}
          detail="Por litro"
        />
      </div>
    </section>
  )
}
