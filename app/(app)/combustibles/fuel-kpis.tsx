"use client"

import { Card, CardContent } from "@/components/ui/card"
import { GasPump, CurrencyCircleDollar, Hash, Gauge } from "@phosphor-icons/react"
import type { ComponentType } from "react"

interface FuelDashboardKpisProps {
  totalLiters: number
  totalAmount: number
  loadCount: number
  /** Rango de período representado (p. ej. "2026-01 — 2026-05"). */
  periodLabel: string
}

const formatCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)
const formatNum = (n: number, max = 0) =>
  new Intl.NumberFormat("es-CL", { maximumFractionDigits: max }).format(n)

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
        <Kpi
          icon={Hash}
          label="Cargas"
          value={formatNum(loadCount)}
        />
        <Kpi
          icon={GasPump}
          label="Litros totales"
          value={formatNum(totalLiters)}
          unit="L"
        />
        <Kpi
          icon={CurrencyCircleDollar}
          label="Total gastado"
          value={formatCLP(totalAmount)}
        />
        <Kpi
          icon={Gauge}
          label="Precio promedio"
          value={formatCLP(avgPricePerLiter)}
          unit="/L"
        />
      </div>
    </section>
  )
}

function Kpi({
  icon: Icon, label, value, unit,
}: {
  icon: ComponentType<{ className?: string; weight?: "bold" }>
  label: string
  value: string
  unit?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-primary)]">
          <Icon className="h-5 w-5" weight="bold" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-[var(--color-text-muted)]">{label}</p>
          <p className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-text)]">
            {value}
            {unit && <span className="ml-0.5 text-sm font-normal text-[var(--color-text-muted)]">{unit}</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
