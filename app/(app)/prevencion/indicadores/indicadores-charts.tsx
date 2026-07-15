"use client"

import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { calcRates, type IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function tooltipStyle() {
  return {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",
    fontSize: "13px",
  }
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="mb-3 text-sm font-medium text-[var(--color-text-muted)]">{title}</p>
      <ResponsiveContainer width="100%" height={280}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

export default function IndicadoresCharts({ monthlyCounters }: { monthlyCounters: IndicatorCounters[] }) {
  const data = monthlyCounters.map((c, i) => ({
    month: MONTH_LABELS[i],
    ...c,
    ...calcRates(c),
  }))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Tasa de Frecuencia Mensual">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Line type="monotone" dataKey="tasaFrecuencia" name="Tasa Frecuencia" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Tasa de Gravedad Mensual">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Line type="monotone" dataKey="tasaGravedad" name="Tasa Gravedad" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Accidentes por Mes">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="accConTiempoPerdido" name="Acc. con Tiempo Perdido" fill="var(--color-danger)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="accSinTiempoPerdido" name="Acc. sin Tiempo Perdido" fill="var(--color-warning)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Incidentes y Daños por Mes">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="incidentes" name="Incidentes" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="danoMaterial" name="Daño Material" fill="var(--color-signal)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="danoAmbiental" name="Daño Ambiental" fill="var(--color-info)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <div className="lg:col-span-2">
        <ChartCard title="Horas Hombre por Mes">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
            <Tooltip contentStyle={tooltipStyle()} />
            <Bar dataKey="horasHombre" name="Horas Hombre" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  )
}
