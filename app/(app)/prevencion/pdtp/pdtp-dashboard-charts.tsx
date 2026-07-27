"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export type MonthlyTrendData = {
  monthName: string
  scheduled: number
  executed: number
  compliancePercent: number
}

export type WorksiteComplianceData = {
  name: string
  percent: number
  executed: number
  scheduled: number
}

export type CategoryBreakdownData = {
  category: string
  scheduled: number
  executed: number
  percent: number
}

export type SstPoint = {
  monthName: string
  tasaFrecuencia: number
  tasaGravedad: number
  accConTiempoPerdido: number
  accSinTiempoPerdido: number
}

export type MaterialEnvPoint = {
  monthName: string
  dangerousIncidents: number
  materialDamage: number
  environmentalSpills: number
}

export type CommonAccidentPoint = {
  type: string
  label: string
  count: number
}

export type WorksiteIncidentPoint = {
  id: string
  name: string
  minor: number
  medical: number
  lostTime: number
  serious: number
  total: number
}

export type PotentialSeverityPoint = {
  severity: string
  label: string
  count: number
}

interface PdtpDashboardChartsProps {
  monthlyTrend: MonthlyTrendData[]
  worksiteCompliance: WorksiteComplianceData[]
  categoryBreakdown: CategoryBreakdownData[]
  sstPoints?: SstPoint[]
  materialEnvPoints?: MaterialEnvPoint[]
  commonAccidents?: CommonAccidentPoint[]
  worksiteIncidents?: WorksiteIncidentPoint[]
  potentialSeverity?: PotentialSeverityPoint[]
}

const trendConfig = {
  scheduled: {
    label: "Programadas",
    color: "#64748b",
  },
  executed: {
    label: "Ejecutadas",
    color: "#2563eb",
  },
} satisfies ChartConfig

const worksiteConfig = {
  percent: {
    label: "% Cumplimiento",
    color: "#16a34a",
  },
} satisfies ChartConfig

const categoryConfig = {
  executed: {
    label: "Ejecutadas",
    color: "#0891b2",
  },
  scheduled: {
    label: "Programadas",
    color: "#cbd5e1",
  },
} satisfies ChartConfig

const sstConfig = {
  tasaFrecuencia: {
    label: "Tasa Frecuencia (TF)",
    color: "#2563eb",
  },
  tasaGravedad: {
    label: "Tasa Gravedad (TG)",
    color: "#dc2626",
  },
} satisfies ChartConfig

const materialEnvConfig = {
  dangerousIncidents: {
    label: "Inc. Peligrosos",
    color: "#7c3aed",
  },
  materialDamage: {
    label: "Daño Material",
    color: "#d97706",
  },
  environmentalSpills: {
    label: "Daño Ambiental",
    color: "#0891b2",
  },
} satisfies ChartConfig

const commonAccidentsConfig = {
  count: {
    label: "Eventos Registrados",
    color: "#2563eb",
  },
} satisfies ChartConfig

const worksiteIncidentsConfig = {
  minor: { label: "Leves", color: "#64748b" },
  medical: { label: "Tratamiento Médico", color: "#0891b2" },
  lostTime: { label: "Tiempo Perdido (CTP)", color: "#d97706" },
  serious: { label: "Graves / Fatales", color: "#dc2626" },
} satisfies ChartConfig

export function PdtpDashboardCharts({
  monthlyTrend,
  worksiteCompliance,
  categoryBreakdown,
  sstPoints = [],
  materialEnvPoints = [],
  commonAccidents = [],
  worksiteIncidents = [],
  potentialSeverity: _potentialSeverity = [],
}: PdtpDashboardChartsProps) {
  const hasMaterialEnvData = materialEnvPoints.some((p) => p.dangerousIncidents > 0 || p.materialDamage > 0 || p.environmentalSpills > 0)

  const [activeTab, setActiveTab] = React.useState("ejecucion")

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="mb-4 w-full justify-start">
        <TabsTrigger value="ejecucion">Ejecuci&oacute;n</TabsTrigger>
        <TabsTrigger value="siniestralidad">Siniestralidad</TabsTrigger>
        <TabsTrigger value="ambiental">Material y Ambiental</TabsTrigger>
      </TabsList>

      <TabsContent value="ejecucion" className="space-y-6">
        {/* ── Fila 1: Ejecución del Programa PDTP + Cumplimiento por Faena ── */}
        <div className="grid gap-6 lg:grid-cols-2">{/* existing Row 1 charts... preserving exact chart code below */}
          {/* Chart 1: Tendencia Mensual */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-900">Tendencia de Ejecución Mensual (Ene - Dic)</h2>
              <p className="text-xs text-slate-500">Comparativa entre actividades programadas y ejecuciones registradas con evidencia.</p>
            </div>
            {monthlyTrend.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin datos de tendencia registrados para el período.</div>
            ) : (
              <ChartContainer config={trendConfig} className="h-64 w-full">
                <AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillExecuted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="fillScheduled" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="scheduled" stroke="#94a3b8" fillOpacity={1} fill="url(#fillScheduled)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="executed" stroke="#2563eb" fillOpacity={1} fill="url(#fillExecuted)" strokeWidth={2.5} />
                </AreaChart>
              </ChartContainer>
            )}
          </section>

          {/* Chart 2: Cumplimiento por Faena */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-900">Porcentaje de Cumplimiento por Faena</h2>
              <p className="text-xs text-slate-500">Desglose comparativo del avance de ejecución en los centros de trabajo asignados.</p>
            </div>
            {worksiteCompliance.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin datos de faenas asignadas para el período.</div>
            ) : (
              <ChartContainer config={worksiteConfig} className="h-64 w-full">
                <BarChart data={worksiteCompliance} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(val) => `${val}%`} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(val, _name, item) => [item?.payload ? `${val}% (${item.payload.executed}/${item.payload.scheduled} ejecuciones)` : `${val}%`, "% Cumplimiento"]} />} />
                  <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={18}>
                    {worksiteCompliance.map((entry, index) => {
                      const color = entry.percent >= 80 ? "#16a34a" : entry.percent >= 50 ? "#d97706" : "#dc2626"
                      return <Cell key={`cell-${index}`} fill={color} />
                    })}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </section>
        </div>

        {/* ── Fila 4: Avance por Eje / Categoría SG-SST ── */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-900">Avance por Eje del Sistema de Gestión (SG-SST)</h2>
            <p className="text-xs text-slate-500">Distribución del nivel de cumplimiento según categoría operacional (Seguridad, Salud Ocupacional, Medio Ambiente, Capacitación).</p>
          </div>
          {categoryBreakdown.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center rounded-xl bg-slate-50/50 p-6 text-center border border-dashed border-slate-200">
              <p className="text-xs font-semibold text-slate-700">Sin categorías registradas en el programa activo</p>
              <p className="mt-1 text-xs text-slate-500">Las categorías se generarán automáticamente al asignar ejes de gestión en la matriz del programa.</p>
            </div>
          ) : (
            <ChartContainer config={categoryConfig} className="h-56 w-full">
              <BarChart data={categoryBreakdown} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="scheduled" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="executed" fill="#0891b2" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ChartContainer>
          )}
        </section>
      </TabsContent>

      <TabsContent value="siniestralidad" className="space-y-6">
        {/* ── SST Indicators chart ── */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Indicadores Canónicos de Siniestralidad SST</h2>
              <p className="text-xs text-slate-500">Tasa de Frecuencia (TF) y Tasa de Gravedad (TG) oficial por millón de HH.</p>
            </div>
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">DS 44 / SST</span>
          </div>
          {sstPoints.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin datos de accidentabilidad registrados para el año.</div>
          ) : (
            <ChartContainer config={sstConfig} className="h-60 w-full">
              <LineChart data={sstPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line type="monotone" dataKey="tasaFrecuencia" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="tasaGravedad" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          )}
        </section>

        {/* ── Row 3: Accidentes comunes + Incidentes por faena ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-900">Accidentes e Incidentes más Frecuentes</h2>
              <p className="text-xs text-slate-500">Clasificación de eventos registrados por tipo de accidente o incidente.</p>
            </div>
            {commonAccidents.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin eventos o accidentes registrados para la faena en este año.</div>
            ) : (
              <ChartContainer config={commonAccidentsConfig} className="h-60 w-full">
                <BarChart data={commonAccidents} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 10 }} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                  <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]}>
                    {commonAccidents.map((entry, index) => (<Cell key={`cell-acc-${index}`} fill={["#2563eb", "#7c3aed", "#0891b2", "#d97706", "#dc2626"][index % 5]} />))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-900">Incidentes por Faena (Desglose por Severidad)</h2>
              <p className="text-xs text-slate-500">Comparativa por centro de trabajo desglosada por nivel de gravedad.</p>
            </div>
            {worksiteIncidents.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin eventos registrados por faena.</div>
            ) : (
              <ChartContainer config={worksiteIncidentsConfig} className="h-60 w-full">
                <BarChart data={worksiteIncidents} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="minor" stackId="a" fill="#64748b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="medical" stackId="a" fill="#0891b2" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="lostTime" stackId="a" fill="#d97706" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="serious" stackId="a" fill="#dc2626" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </section>
        </div>
      </TabsContent>

      <TabsContent value="ambiental" className="space-y-6">
        {/* ── Material/Environmental chart ── */}
        {hasMaterialEnvData ? (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Indicadores de Impacto Material y Ambiental</h2>
                <p className="text-xs text-slate-500">Incidentes peligrosos, daños materiales y derrames ambientales en la operación.</p>
              </div>
              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Medio Ambiente</span>
            </div>
            <ChartContainer config={materialEnvConfig} className="h-60 w-full">
              <BarChart data={materialEnvPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="dangerousIncidents" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                <Bar dataKey="materialDamage" fill="#d97706" radius={[4, 4, 0, 0]} />
                <Bar dataKey="environmentalSpills" fill="#0891b2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Indicadores de Impacto Material y Ambiental</h2>
                <p className="text-xs text-slate-500">Incidentes peligrosos, daños materiales y derrames ambientales en la operación.</p>
              </div>
              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Medio Ambiente</span>
            </div>
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">Sin eventos de impacto ambiental o material registrados.</div>
          </section>
        )}
      </TabsContent>
    </Tabs>
  )
}
