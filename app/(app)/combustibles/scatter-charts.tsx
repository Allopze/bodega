"use client"

import { ScatterChart as ReScatter, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { ScatterPoint } from "@/lib/combustibles/operations-dashboard"
import { ChartDataTable } from "@/components/ui/chart-data-table"

const DOT_COLOR = "var(--color-primary)"
const DOT_OPACITY = 0.55
const GRID_COLOR = "var(--color-border)"

function chartAxisProps() {
  return { axisLine: false, tickLine: false, tick: { fill: "var(--color-text-muted)", fontSize: 11 } }
}

function EmptyScatter({ label }: { label: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">{label}</p>
    </div>
  )
}

const num = (value: number, digits = 0) => value.toLocaleString("es-CL", { maximumFractionDigits: digits })

/**
 * Lectura equivalente de una nube de puntos (TASK-UI-015).
 *
 * Una tabla de trescientas filas no es una alternativa a un scatter: nadie la
 * lee. Lo que el gráfico responde es "¿el consumo acompaña al uso, y quién se
 * sale de la nube?", así que eso es lo que se dice — correlación, rangos — y la
 * tabla lista sólo los puntos extremos, que son los que motivan una acción.
 */
function scatterSummary(points: ScatterPoint[], meterLabel: string, meterUnit: string) {
  const n = points.length
  const meanX = points.reduce((sum, p) => sum + p.meterReading, 0) / n
  const meanY = points.reduce((sum, p) => sum + p.liters, 0) / n
  let cov = 0, varX = 0, varY = 0
  for (const p of points) {
    const dx = p.meterReading - meanX
    const dy = p.liters - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  // Pearson: sin varianza en algún eje la correlación no está definida, y decir
  // "0" ahí sería afirmar independencia donde no hay nada que afirmar.
  const r = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : null

  const relacion = r === null
    ? "No hay dispersión suficiente en algún eje para estimar una relación."
    : Math.abs(r) >= 0.7
      ? `Relación ${r > 0 ? "directa" : "inversa"} fuerte entre ${meterLabel.toLowerCase()} y litros (r = ${num(r, 2)}).`
      : Math.abs(r) >= 0.4
        ? `Relación ${r > 0 ? "directa" : "inversa"} moderada (r = ${num(r, 2)}): el uso explica parte del consumo, no todo.`
        : `Sin relación clara entre ${meterLabel.toLowerCase()} y litros (r = ${num(r, 2)}): el consumo no se explica por el uso registrado.`

  // Extremos por litros: son los que se salen de la nube hacia arriba.
  const extremos = [...points].sort((a, b) => b.liters - a.liters).slice(0, 8)

  return {
    conclusion: `${n} ${n === 1 ? "carga" : "cargas"} con ${meterLabel.toLowerCase()}. ${relacion}`,
    caption: `${meterLabel} entre ${num(Math.min(...points.map((p) => p.meterReading)))} y ${num(Math.max(...points.map((p) => p.meterReading)))} ${meterUnit}. Se listan las ${extremos.length} cargas de mayor volumen.`,
    rows: extremos.map((p) => ({
      label: p.equipmentCode ? `${p.equipmentCode} · ${p.plate}` : p.plate,
      values: [`${num(p.liters)} L`, `${num(p.meterReading)} ${meterUnit}`, p.worksiteName ?? "—"],
    })),
  }
}

function MeterScatter({
  points,
  meterLabel,
  meterUnit,
  axisLabel,
  ariaLabel,
}: {
  points: ScatterPoint[]
  meterLabel: string
  meterUnit: string
  axisLabel: string
  ariaLabel: string
}) {
  const data = points.map((p) => ({ x: p.meterReading, y: p.liters, plate: p.plate, code: p.equipmentCode, type: p.equipmentTypeName, worksite: p.worksiteName }))
  const summary = scatterSummary(points, meterLabel, meterUnit)

  return (
    <>
      <ChartDataTable
        title={ariaLabel}
        groupLabel="Equipo"
        columns={["Litros", meterLabel, "Faena"]}
        rows={summary.rows}
        conclusion={summary.conclusion}
        caption={summary.caption}
        numericFrom={0}
        className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
      />
      <div className="h-80" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" debounce={200}>
          <ReScatter margin={{ top: 8, right: 12, left: 0, bottom: 36 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 5" />
            <XAxis dataKey="x" name={meterLabel} unit={` ${meterUnit}`} type="number" {...chartAxisProps()} label={{ value: axisLabel, position: "bottom", offset: -4, fill: "var(--color-text-muted)", fontSize: 11 }} />
            <YAxis dataKey="y" name="Litros" unit=" L" width={48} type="number" {...chartAxisProps()} label={{ value: "Litros", angle: -90, position: "insideLeft", offset: -4, fill: "var(--color-text-muted)", fontSize: 11 }} />
            <ZAxis range={[52, 52]} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0]!.payload as (typeof data)[number]
                return (
                  <div className="min-w-36 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)] text-xs">
                    <p className="mb-1 font-semibold text-[var(--color-text)]">{point.code ? `${point.code} · ` : ""}{point.plate}</p>
                    {point.type && <p className="text-[var(--color-text-muted)]">{point.type}</p>}
                    {point.worksite && <p className="text-[var(--color-text-muted)]">{point.worksite}</p>}
                    <div className="mt-1 flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">{meterLabel}</span><span className="font-mono">{point.x.toLocaleString("es-CL")} {meterUnit}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Litros</span><span className="font-mono">{point.y.toLocaleString("es-CL")} L</span></div>
                  </div>
                )
              }}
            />
            <Scatter data={data} fill={DOT_COLOR} fillOpacity={DOT_OPACITY} />
          </ReScatter>
        </ResponsiveContainer>
      </div>
    </>
  )
}

export function LitersVsKmChart({ points }: { points: ScatterPoint[] }) {
  if (points.length === 0) return <EmptyScatter label="Sin registros con odómetro para este filtro." />
  return <MeterScatter points={points} meterLabel="Odómetro" meterUnit="km" axisLabel="Odómetro (km)" ariaLabel="Dispersión litros vs kilometraje" />
}

export function LitersVsHourMeterChart({ points }: { points: ScatterPoint[] }) {
  if (points.length === 0) return <EmptyScatter label="Sin registros con horómetro para este filtro." />
  return <MeterScatter points={points} meterLabel="Horómetro" meterUnit="h" axisLabel="Horómetro (h)" ariaLabel="Dispersión litros vs horómetro" />
}
