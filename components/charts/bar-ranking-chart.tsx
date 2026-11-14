"use client"

import type { MouseEvent } from "react"
import { useRouter } from "next/navigation"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts"
import { DenseChart } from "@/components/charts/dense-chart"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { RankedList } from "@/components/ui/ranked-list"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatCompactQty, formatQty } from "@/lib/utils"

/**
 * Ranking o reparto por categoría dibujado como barras horizontales: equipos con más
 * km, faenas con más litros, OT abiertas por estado. Es la forma de gráfico de un
 * ranking en los tableros (Indicadores de Control operacional): una lista de barras
 * (`RankedList`) se lee como tabla, no como gráfico.
 *
 * - Un solo tono por defecto: el largo codifica la cifra y el color no agrega nada.
 *   `item.color` sólo cuando el color sí codifica algo (el estado de una OT).
 * - La cifra va escrita al final de cada barra: se lee sin apuntar.
 * - Con `href`, el rótulo de la categoría es un enlace del SVG (enfocable con el
 *   teclado) y la barra navega al hacer clic.
 * - Bajo 360 px de pantalla se reemplaza por el mismo ranking como `RankedList`
 *   (`DenseChart`), que conserva los enlaces.
 */

export interface BarRankingItem {
  key: string
  label: string
  value: number
  /** Texto secundario del tooltip y de la lista angosta («Camioneta · JGZH-30»). */
  detail?: string
  href?: string
  /** Sólo si el color codifica algo; si no, todas las barras van en `color`. */
  color?: string
}

export interface BarRankingChartProps {
  items: BarRankingItem[]
  /** Nombre del gráfico para lectores de pantalla. */
  ariaLabel: string
  /** Sufijo de la cifra («km», « h», « L», « OT»). Se escribe tal cual tras el número. */
  unit?: string
  /** Decimales de la cifra escrita al final de la barra. */
  digits?: number
  /** «desc»: de mayor a menor (ranking). «input»: el orden de llegada (estados de un flujo). */
  order?: "desc" | "input"
  limit?: number
  color?: string
}

const ROW_HEIGHT = 30
const MAX_LABEL = 22

function truncate(label: string) {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

export function BarRankingChart({
  items,
  ariaLabel,
  unit = "",
  digits = 0,
  order = "desc",
  limit = 8,
  color = CHART_COLORS.brand,
}: BarRankingChartProps) {
  const motion = useChartMotion()
  const router = useRouter()
  const rows = (order === "desc" ? [...items].sort((a, b) => b.value - a.value) : items).slice(0, limit)
  if (rows.length === 0) return null

  const format = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: digits })}${unit}`
  const data = rows.map((row) => ({ ...row, short: truncate(row.label) }))
  const byShort = new Map(data.map((row) => [row.short, row]))
  const longest = Math.max(...data.map((row) => row.short.length))
  // Ancho del eje de rótulos según el más largo: ni corta «Cholguan - Arauco» ni deja 130 px vacíos para «CA-17».
  const labelWidth = Math.min(160, Math.max(56, Math.round(longest * 6.6) + 12))
  const config: ChartConfig = { value: { label: ariaLabel, color } }
  const clickable = rows.some((row) => row.href)

  const go = (href: string | undefined) => (event?: MouseEvent) => {
    if (!href) return
    event?.preventDefault()
    router.push(href)
  }

  const ranking = (
    <RankedList
      ariaLabel={ariaLabel}
      format="count"
      unit={unit}
      order={order === "desc" ? "desc" : "input"}
      limit={rows.length}
      showShare={false}
      items={rows.map((row) => ({ key: row.key, label: row.label, value: row.value, detail: row.detail, href: row.href }))}
    />
  )

  return (
    <DenseChart fallback={ranking}>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(120, data.length * ROW_HEIGHT + 24) }}
        role="img"
        aria-label={`${ariaLabel}; «Ver datos» trae las cifras exactas`}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 88, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="2 5" />
          <XAxis type="number" hide domain={[0, "dataMax"]} tickFormatter={formatCompactQty} />
          <YAxis
            type="category"
            dataKey="short"
            tickLine={false}
            axisLine={false}
            width={labelWidth}
            interval={0}
            tick={({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
              const value = String(payload?.value ?? "")
              const row = byShort.get(value)
              const text = (
                <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--color-text)">
                  {value}
                </text>
              )
              return row?.href ? (
                <a href={row.href} onClick={go(row.href)} className="cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
                  <title>{row.label}</title>
                  {text}
                </a>
              ) : (
                <g>
                  <title>{row?.label ?? value}</title>
                  {text}
                </g>
              )
            }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) => {
                  const row = payload[0]?.payload as BarRankingItem | undefined
                  return row ? [row.label, row.detail].filter(Boolean).join(" · ") : ""
                }}
                formatter={(value) => <span className="tabular-nums">{format(Number(value))}</span>}
              />
            }
          />
          <Bar
            dataKey="value"
            fill={color}
            radius={[0, 3, 3, 0]}
            barSize={18}
            cursor={clickable ? "pointer" : undefined}
            onClick={(entry: { payload?: BarRankingItem }) => go(entry.payload?.href)()}
            {...motion}
          >
            {data.map((row) => <Cell key={row.key} fill={row.color ?? color} />)}
            <LabelList
              dataKey="value"
              // Un `<text>` propio y no el de recharts: el suyo parte la cifra en dos líneas
              // («35.366 / km») cuando el margen derecho le queda justo.
              content={({ x, y, width, height, value }) => (
                <text
                  x={Number(x ?? 0) + Number(width ?? 0) + 8}
                  y={Number(y ?? 0) + Number(height ?? 0) / 2}
                  dy={4}
                  fontSize={12}
                  fill="var(--color-text-muted)"
                  className="tabular-nums"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {format(Number(value))}
                </text>
              )}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </DenseChart>
  )
}
