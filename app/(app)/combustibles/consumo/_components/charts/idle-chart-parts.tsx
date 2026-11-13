"use client"

import type { ReactNode } from "react"
import type { ChartTooltipItem } from "@/components/ui/chart"
import { formatQty } from "@/lib/utils"

/** Colores del ralentí: trabajar y gastar en vacío no son alertas, así que ni rojo ni ámbar. */
export const IDLE_COLORS = {
  working: "var(--color-primary)",
  idle: "var(--color-info)",
  pct: "var(--color-text)",
} as const

const compact = (value: number, digits = 1) => formatQty(value, undefined, { maximumFractionDigits: digits })

/** Fila de tooltip «● nombre   valor unidad». */
export function tooltipRow(value: unknown, name: unknown, item: ChartTooltipItem, unit: (series: string) => string): ReactNode {
  const series = String(name)
  return (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color ?? item.fill }} />
      <span className="flex flex-1 justify-between gap-3 leading-none">
        <span className="text-[var(--color-text-muted)]">{series}</span>
        <span className="font-mono font-medium tabular-nums text-[var(--color-text)]">{typeof value === "number" ? `${compact(value)} ${unit(series)}` : String(value)}</span>
      </span>
    </>
  )
}

export const hoursTick = (value: number) => compact(value, 0)
export const pctTick = (value: number) => `${compact(value, 0)} %`
export const litersTick = (value: number) => (Math.abs(value) >= 1000 ? `${compact(value / 1000)}K` : compact(value, 0))
