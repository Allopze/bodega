"use client"

import { useRouter } from "next/navigation"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { TaeGroupRow } from "@/lib/combustibles/tae-dashboard"
import { buildTaeGroupDrilldownHref } from "./tae-group-chart-url"

const BAR_COLOR = "var(--color-primary)"
const GRID_COLOR = "var(--color-border)"
const liters = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

/** Ranking de litros TAE por conductor, supervisor o punto de suministro. Cada
 *  barra abre la bitácora filtrada por ese nombre — no hay una ruta de detalle
 *  dedicada para "todas las cargas de un conductor". */
export function TaeGroupChart({ data, drilldownBaseHref }: { data: TaeGroupRow[]; drilldownBaseHref: string }) {
  const router = useRouter()
  if (data.length === 0) return <EmptyChart label="No hay cargas TAE en este filtro." />

  const chartData = data.slice(0, 10).map((row) => ({ name: truncate(row.group, 16), fullName: row.group, liters: row.liters, count: row.count }))

  return (
    <>
    <div className="h-64" aria-label="Litros TAE por grupo">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 2 }} title="Litros TAE por grupo. Selecciona una barra para ver esas cargas en la bitácora.">
          <CartesianGrid horizontal={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis type="number" tickFormatter={(v) => `${liters.format(Number(v))} L`} axisLine={false} tickLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]!.payload as (typeof chartData)[number]
              return (
                <div className="min-w-40 border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 shadow-(--shadow-md) text-xs">
                  <p className="mb-1 font-semibold text-(--color-text)">{point.fullName}</p>
                  <div className="flex justify-between gap-4"><span className="text-(--color-text-muted)">Litros</span><span className="font-mono">{liters.format(point.liters)} L</span></div>
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
            onClick={(entry) => router.push(buildTaeGroupDrilldownHref(drilldownBaseHref, (entry as unknown as { payload: { fullName: string } }).payload.fullName))}
            animationDuration={420}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center border border-dashed border-(--color-border-strong) bg-(--color-surface-2) px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-(--color-text-subtle)" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-(--color-text-muted)">{label}</p>
    </div>
  )
}
