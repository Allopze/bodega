"use client"
import { ChartEmpty } from "@/components/ui/chart-empty"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { SpendByModuleRow, SpendByMonthRow, VehicleCostRow, WorksiteSpendRow } from "@/lib/services/analytics"
import { formatCLP, formatCompactCLP } from "@/lib/utils"
import { CHART_SERIES, chartTooltipStyle } from "@/lib/chart-palette"
import { formatTrendMonth, formatTrendMonthShort, fuelGapMonthKeys, isIsolatedPoint, trendChartRows, trendTooltipEntry } from "./analytics-trend"

// Segunda de las tres paletas que coexistían (G-07). Ahora es la única del
// producto, en `lib/chart-palette.ts`: sus hues están verificados para
// distinguirse entre sí como categorías contiguas, que es lo que esta lista
// no garantizaba (primary, success y warning son verde, verde y ámbar).
const COLORS = CHART_SERIES

/** Punto de una serie con huecos: sólo donde no habría línea (un valor entre dos huecos); el resto ya se ve en el trazo. */
function isolatedDot(values: Array<number | null>, color: string) {
  function IsolatedDot({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) {
    if (cx === undefined || cy === undefined || index === undefined || !isIsolatedPoint(values, index)) return <g />
    return <circle cx={cx} cy={cy} r={3.5} fill={color} />
  }
  return IsolatedDot
}

export function MonthlySpendChart({ data }: { data: SpendByMonthRow[] }) {
  const gaps = fuelGapMonthKeys(data)
  // La serie trae los 12 meses con ceros donde no hubo movimiento: «sin gasto» es que todos sean cero.
  // Un mes sin datos del proveedor no es un cero de combustible: si no hay compras, lo dice el aviso.
  if (data.every((row) => row.totalAmount === 0)) {
    return <ChartEmpty
      label="Aún no hay gasto en los últimos 12 meses"
      hint={`No se registraron órdenes de compra ni combustible en las faenas seleccionadas durante esta ventana. Revisa los filtros o que existan movimientos.${gaps.length > 0 ? " El proveedor de combustible no tiene datos de algunos de estos meses, así que su gasto no se conoce." : ""}`}
      ctaLabel="Ver compras"
      ctaHref="/compras"
    />
  }

  // Combustible y total en `null` donde el proveedor no tiene datos: la línea se corta (sin `connectNulls`).
  const rows = trendChartRows(data)
  const totalColor = "var(--color-primary)"
  const fuelColor = "var(--color-warning)"

  return (
    <>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" tickFormatter={formatTrendMonthShort} minTickGap={8} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis tickFormatter={formatCompactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={58} />
          {/* `filterNull={false}`: recharts omite del tooltip las series nulas, y el mes sin datos del proveedor perdería su aviso. */}
          <Tooltip
            contentStyle={chartTooltipStyle()}
            filterNull={false}
            // Un mes sin cerrar tiene menos días que los demás: se dice en el tooltip para que no se lea como una caída.
            labelFormatter={(label) => {
              const month = String(label)
              return data.find((row) => row.month === month)?.partial ? `${formatTrendMonth(month)} (parcial)` : formatTrendMonth(month)
            }}
            formatter={(value, name) => trendTooltipEntry(String(name), value == null ? null : Number(value), formatCLP)}
          />
          <Line type="monotone" dataKey="totalAmount" name="Total" stroke={totalColor} strokeWidth={2.5} dot={isolatedDot(rows.map((row) => row.totalAmount), totalColor)} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="purchasingAmount" name="Compras" stroke="var(--color-info)" strokeWidth={1.8} dot={false} />
          <Line type="monotone" dataKey="fuelAmount" name="Combustible" stroke={fuelColor} strokeWidth={1.8} dot={isolatedDot(rows.map((row) => row.fuelAmount), fuelColor)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
export function ModuleSpendChart({ data }: { data: SpendByModuleRow[] }) {
  if (data.length === 0) return <ChartEmpty label="Sin gasto para distribuir" hint="La distribución por módulo aparece cuando hay compras o combustible registrados en el período." />

  return (
    <>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ top: 6, right: 16, left: 10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tickFormatter={formatCompactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="module" width={92} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [formatCLP(Number(value)), "Monto"]} />
          <Bar dataKey="totalAmount" name="Monto" radius={[0, 5, 5, 0]}>
            {data.slice(0, 8).map((row, index) => (
              <Cell key={row.module} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

export function RankingBarChart({
  data,
  labelKey,
  valueKey,
  emptyLabel,
}: {
  data: Array<WorksiteSpendRow | VehicleCostRow>
  labelKey: "name" | "plate"
  valueKey: "totalAmount" | "totalOperationalCost" | "totalFuelAmount"
  emptyLabel: string
}) {
  if (data.length === 0) return <ChartEmpty label={emptyLabel} />

  const chartData = data.slice(0, 8).map((row) => ({
    name: labelKey === "plate" && "plate" in row ? row.plate : "name" in row ? row.name : "",
    value: valueKey in row ? Number((row as unknown as Record<string, unknown>)[valueKey] ?? 0) : 0,
  }))

  return (
    <>
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tickFormatter={formatCompactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={118} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [formatCLP(Number(value)), "Costo"]} />
          <Bar dataKey="value" radius={[0, 5, 5, 0]}>
            {chartData.map((row, index) => (
              <Cell key={row.name || index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
