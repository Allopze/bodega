"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { KpisFilters } from "./kpis-filters"
import { KpisTrendChart } from "./kpis-trend-chart"
import { LaborHoursForm } from "./labor-hours-form"

interface Indicators {
  target: number
  annual: { planned: number; executed: number; percent: number | null }
  monthly: { month: number; planned: number; executed: number; percent: number | null }[]
}

interface FrequencyRate {
  accidentCount: number
  totalHours: number
  frequencyRate: number | null
}

interface Props {
  year: number
  worksiteId?: string
  worksites: { id: string; name: string }[]
  indicators: Indicators | null
  rate: FrequencyRate | null
  canManage: boolean
}

export function KpisPanel({ year, worksiteId, worksites, indicators, rate, canManage }: Props) {
  const [showLaborHoursForm, setShowLaborHoursForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Indicadores preventivos"
        description="Cumplimiento, tasa de frecuencia y siniestralidad por faena (N° 7 PDTP)"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "KPIs" }]} />}
        actions={
          <>
            <PreventionExportButton href={`/api/prevencion/kpis/export?anio=${year}${worksiteId ? `&faena=${worksiteId}` : ""}`} label="Exportar KPIs" />
            {canManage && worksiteId ? (
              <Button size="sm" onClick={() => setShowLaborHoursForm((s) => !s)}>
                <Plus size={16} className="mr-1" />
                {showLaborHoursForm ? "Cancelar" : "Registrar horas hombre"}
              </Button>
            ) : null}
          </>
        }
      />

      <KpisFilters year={year} worksiteId={worksiteId} worksites={worksites} />

      {canManage && showLaborHoursForm && worksiteId ? (
        <LaborHoursForm worksiteId={worksiteId} onDone={() => setShowLaborHoursForm(false)} />
      ) : null}

      {!indicators ? (
        <EmptyState compact title="Sin programa preventivo" description="No hay un Programa de Trabajo Preventivo para el año seleccionado." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Cumplimiento anual</p>
              <p className="text-h1 font-semibold">{indicators.annual.percent !== null ? `${Math.round(indicators.annual.percent * 100)}%` : "—"}</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Meta</p>
              <p className="text-h1 font-semibold">{Math.round(indicators.target * 100)}%</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Índice de frecuencia (IF)</p>
              <p className="text-h1 font-semibold">{rate?.frequencyRate !== null && rate?.frequencyRate !== undefined ? rate.frequencyRate.toFixed(1) : "—"}</p>
              {rate ? <p className="text-xs text-muted-foreground">{rate.accidentCount} accidentes · {rate.totalHours.toLocaleString("es-CL")} HHT</p> : null}
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Índice de gravedad (IG)</p>
              <p className="text-h1 font-semibold">—</p>
              <p className="text-xs text-muted-foreground">Requiere registrar días perdidos por accidente</p>
            </div>
          </div>

          <div className="mb-6">
            <KpisTrendChart monthly={indicators.monthly} />
          </div>

          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Planificadas</TableHead>
                  <TableHead className="text-right">Ejecutadas</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indicators.monthly.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyState compact title="Sin datos" description="No hay indicadores para el año seleccionado." />
                    </TableCell>
                  </TableRow>
                ) : indicators.monthly.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>Mes {m.month}</TableCell>
                    <TableCellNum>{m.planned}</TableCellNum>
                    <TableCellNum>{m.executed}</TableCellNum>
                    <TableCellNum>{m.percent !== null ? `${Math.round(m.percent * 100)}%` : "—"}</TableCellNum>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </>
      )}
    </>
  )
}
