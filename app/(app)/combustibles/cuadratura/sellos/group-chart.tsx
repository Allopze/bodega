"use client"
import { ChartEmpty } from "@/components/ui/chart-empty"

import { useRouter } from "next/navigation"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { TaeGroupRow } from "@/lib/combustibles/tae-dashboard"
import { formatQty } from "@/lib/utils"
import { buildTaeGroupDrilldownHref } from "./group-chart-url"
import { useChartMotion } from "@/components/ui/chart-interactions"

const BAR_COLOR = "var(--color-primary)"
const GRID_COLOR = "var(--color-border)"

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max)}…` : label
}
/** Ranking de litros de las cargas en terreno por conductor, supervisor o punto de carga. Cada
 *  barra abre Cargas filtrada por ese nombre — no hay una ruta de detalle
 *  dedicada para "todas las cargas de un conductor". */
export function TaeGroupChart({ data, drilldownBaseHref }: { data: TaeGroupRow[]; drilldownBaseHref: string }) {
  const motion = useChartMotion()
  const router = useRouter()
  if (data.length === 0) return <ChartEmpty icon={<ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />} className="border-[var(--color-border-strong)]" label="No hay cargas en terreno en este período." />

  const chartData = data.slice(0, 10).map((row) => ({ name: truncate(row.group, 16), fullName: row.group, liters: row.liters, count: row.count }))

  return (
    <>
    <div className="h-64" aria-label="Litros por grupo">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 2 }} title="Litros por grupo. Selecciona una barra para ver esas cargas en Cargas.">
          <CartesianGrid horizontal={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis type="number" tickFormatter={(v) => `${formatQty(Number(v), undefined, { maximumFractionDigits: 0 })} L`} axisLine={false} tickLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]!.payload as (typeof chartData)[number]
              return (
                <div className="min-w-40 border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 shadow-(--shadow-md) text-xs">
                  <p className="mb-1 font-semibold text-(--color-text)">{point.fullName}</p>
                  <div className="flex justify-between gap-4"><span className="text-(--color-text-muted)">Litros</span><span className="font-mono">{formatQty(point.liters, undefined, { maximumFractionDigits: 0 })} L</span></div>
                  <div className="flex justify-between gap-4"><span className="text-(--color-text-muted)">Cargas</span><span className="font-mono">{point.count}</span></div>
                </div>
              )
            }}
          />
          <Bar
            dataKey="liters"
            radius={[0, 2, 2, 0]}
            name="Litros"
            barSize={17}
            fill={BAR_COLOR}
            style={{ cursor: "pointer" }}
            onClick={(entry) => {
              const fullName = (entry as unknown as { payload: { fullName: string } }).payload.fullName
              // Un grupo reservado ("Reservado 1") no es un nombre: filtrar
              // Cargas por él no devolvería nada y el servidor lo ignora.
              if (/^Reservado \d+$/.test(fullName)) return
              router.push(buildTaeGroupDrilldownHref(drilldownBaseHref, fullName))
            }}
            {...motion}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
