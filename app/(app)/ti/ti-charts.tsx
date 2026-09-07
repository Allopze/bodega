"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { CHART_COLORS, CHART_SERIES } from "@/lib/chart-palette"
import { formatCLP } from "@/lib/utils"

interface TiChartsProps {
  byType: { name: string; total: number }[]
  byWorksite: { worksiteName: string; total: number }[]
  byStatus: { name: string; total: number }[]
  maintenanceByMonth: { month: string; cost: number; count: number }[]
  byAge: { tramo: string; total: number }[]
}

const CARD = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"

function ChartTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
      <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
    </div>
  )
}

function StatusPie({ data }: { data: { name: string; total: number }[] }) {
  if (data.length === 0) return null
  return (
    <div className={CARD}>
      <ChartTitle title="Estado de activos" description="Distribución del parque por estado" />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={CHART_SERIES[index % CHART_SERIES.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TypeBar({ data }: { data: { name: string; total: number }[] }) {
  if (data.length === 0) return null
  return (
    <div className={CARD}>
      <ChartTitle title="Activos por tipo" description="Composición del inventario" />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="total" fill={CHART_COLORS.brand} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function WorksiteBar({ data }: { data: { worksiteName: string; total: number }[] }) {
  if (data.length === 0) return null
  return (
    <div className={CARD}>
      <ChartTitle title="Activos por faena" description="Dónde está el parque" />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="worksiteName" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="total" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Gasto y cantidad de reparaciones NO comparten escala: los conteos quedarían
 * pegados al piso junto a los montos. Eje doble (regla A5b).
 */
function MaintenanceTrend({ data }: { data: { month: string; cost: number; count: number }[] }) {
  if (data.length === 0) return null
  return (
    <div className={CARD}>
      <ChartTitle title="Reparaciones por mes" description="Gasto y cantidad de intervenciones (últimos 12 meses)" />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -10, right: -10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis yAxisId="cost" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCLP(v).replace("$", "$")} width={70} />
            <YAxis yAxisId="count" orientation="right" tickLine={false} axisLine={false} />
            <Tooltip formatter={(value, name) => (name === "cost" ? [formatCLP(Number(value ?? 0)), "Gasto"] : [String(value ?? ""), "Cantidad"])} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="cost" type="monotone" dataKey="cost" name="Gasto" stroke={CHART_COLORS.brand} strokeWidth={2} />
            <Line yAxisId="count" type="monotone" dataKey="count" name="Cantidad" stroke={CHART_COLORS.signal} strokeWidth={2} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Inventario filtrado al tramo de renovación (mismo criterio que `getAssetsByAge`). */
const REPLACEABLE_HREF = "/ti/activos?antiguedad_min=5"

function AgeBar({ data }: { data: { tramo: string; total: number }[] }) {
  if (data.length === 0) return null
  const replaceable = data.find((row) => row.tramo === "5+ años")
  return (
    <div className={CARD}>
      <ChartTitle title="Antigüedad del parque" description="Años desde la fecha de compra" />
      {replaceable && replaceable.total > 0 && (
        // El tramo antiguo es la pregunta de renovación: se hace navegable al
        // inventario filtrado, que es donde se actúa.
        <Link
          href={REPLACEABLE_HREF}
          className="mb-2 inline-flex text-xs font-semibold text-[var(--color-primary)] hover:underline"
        >
          Ver los {replaceable.total} equipos de 5 años o más →
        </Link>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="tramo" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="total" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TiChartsInner(props: TiChartsProps) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">
      <StatusPie data={props.byStatus} />
      <TypeBar data={props.byType} />
      <WorksiteBar data={props.byWorksite} />
      <MaintenanceTrend data={props.maintenanceByMonth} />
      <AgeBar data={props.byAge} />
    </div>
  )
}

/** Recharts solo corre en cliente; el dashboard lo carga lazy como el resto de gráficos de CHOME. */
export const TiCharts = dynamic(() => Promise.resolve(TiChartsInner), {
  ssr: false,
  loading: () => <div className="mt-6 h-48 animate-pulse rounded-2xl bg-[var(--color-surface-2)]" aria-hidden />,
})
