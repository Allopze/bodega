"use client"

import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"

const STAGE_COLOR = "var(--color-primary)"
const UNAVAILABLE_COLOR = "var(--color-border-strong)"
const GRID_COLOR = "var(--color-border)"

const liters = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })

export interface CycleStagePoint {
  stage: string
  liters: number | null
  records: number | null
}

/**
 * Barras en el orden recibido → registrado → entregado → consumido: leídas de
 * izquierda a derecha, la caída de una barra a la siguiente ES el flujo físico
 * (satisface a la vez "diferencias entre etapas" y "flujo del ciclo" — un solo
 * gráfico, una sola pregunta: ¿dónde se pierde combustible entre etapas?).
 */
export function CycleStageChart({ stages }: { stages: CycleStagePoint[] }) {
  const hasAnyData = stages.some((s) => s.liters != null)
  if (!hasAnyData) return <EmptyChart label="No hay ninguna etapa con fuente disponible en este filtro." />

  const chartData = stages.map((s) => ({ ...s, value: s.liters ?? 0 }))

  return (
    <div className="h-64" aria-label="Litros por etapa del ciclo físico, en orden recibido → registrado → entregado → consumido">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart data={chartData} margin={{ top: 20, right: 12, left: 4, bottom: 4 }} title="Litros por etapa del ciclo. Una caída entre barras es la diferencia entre esas dos etapas.">
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 12 }} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]!.payload as (typeof chartData)[number]
              return (
                <div className="min-w-40 border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 shadow-(--shadow-md) text-xs">
                  <p className="mb-1 font-semibold text-(--color-text)">{point.stage}</p>
                  {point.liters == null ? <p className="text-(--color-text-muted)">Sin fuente disponible</p> : (
                    <>
                      <div className="flex justify-between gap-4"><span className="text-(--color-text-muted)">Litros</span><span className="font-mono">{liters.format(point.liters)} L</span></div>
                      <div className="flex justify-between gap-4"><span className="text-(--color-text-muted)">Registros</span><span className="font-mono">{point.records}</span></div>
                    </>
                  )}
                </div>
              )
            }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={72} name="Litros" animationDuration={420} animationEasing="ease-out">
            <LabelList dataKey="value" position="top" formatter={(value: unknown) => typeof value === "number" && value > 0 ? `${liters.format(value)} L` : ""} style={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            {chartData.map((point) => <Cell key={point.stage} fill={point.liters == null ? UNAVAILABLE_COLOR : STAGE_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
