"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Pencil } from "@phosphor-icons/react/dist/ssr"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableRoot, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCellNum } from "@/components/ui/table"
import { KpiCard } from "@/app/(app)/analitica/analytics-kpi-card"
import { Gauge, Heartbeat, WarningDiamond, Siren, Wrench, Drop } from "@phosphor-icons/react/dist/ssr"
import { buildMonthlyCounters, calcRates, sumCounters, type IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"
import type { SafetyIndicator } from "@/db/schema"
import { IndicadoresEditModal } from "./indicadores-edit-modal"
import { IndicatorPeriodCloseButton } from "./indicator-period-close-button"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const YEAR_RANGE = 3 // años hacia atrás que se ofrecen en el selector, además del actual
const NO_CLOSED_PERIODS: string[] = []
// Recharts usa contextos de React y debe evaluarse exclusivamente en el navegador.
const IndicadoresCharts = dynamic(() => import("./indicadores-charts"), { ssr: false })

function fmtNum(n: number) {
  return n ? n.toLocaleString("es-CL") : "0"
}

function fmtRate(rate: number | null) {
  return rate === null ? "No calculable" : rate.toFixed(2)
}

export function IndicadoresDashboard({
  worksites,
  indicatorRows,
  year,
  currentYear,
  canManage,
  canClose = false,
  officialRatesEnabled = false,
  closedPeriodKeys = NO_CLOSED_PERIODS,
}: {
  worksites: Array<{ id: string; name: string }>
  indicatorRows: SafetyIndicator[]
  year: number
  currentYear: number
  canManage: boolean
  canClose?: boolean
  officialRatesEnabled?: boolean
  closedPeriodKeys?: string[]
}) {
  const router = useRouter()
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>(worksites[0]?.id ?? "total")
  const [editingMonth, setEditingMonth] = useState<number | null>(null)

  const isTotalView = selectedWorksiteId === "total"
  const monthlyCounters = useMemo(
    () => buildMonthlyCounters(indicatorRows, selectedWorksiteId),
    [indicatorRows, selectedWorksiteId],
  )
  const totals = useMemo(() => sumCounters(monthlyCounters), [monthlyCounters])
  const totalsRates = calcRates(totals)
  const selectedWorksiteName = worksites.find((worksite) => worksite.id === selectedWorksiteId)?.name
  const hasRecordsForSelection = !isTotalView && indicatorRows.some((row) => row.worksiteId === selectedWorksiteId)
  const suggestedMonth = useMemo(() => {
    const currentMonth = new Date().getMonth() + 1
    if (year === currentYear) return currentMonth
    return Array.from({ length: 12 }, (_, index) => index + 1).find((month) => !indicatorRows.some((row) => (
      row.worksiteId === selectedWorksiteId && row.year === year && row.month === month
    ))) ?? 1
  }, [currentYear, indicatorRows, selectedWorksiteId, year])
  const suggestedMonthLabel = MONTHS[suggestedMonth - 1]

  function handleYearChange(nextYear: string) {
    router.push(`/prevencion/indicadores?year=${nextYear}`)
  }

  const yearOptions = Array.from({ length: YEAR_RANGE + 1 }, (_, i) => currentYear - i)
  if (!yearOptions.includes(year)) yearOptions.push(year)
  yearOptions.sort((a, b) => b - a)

  return (
    <div className="space-y-4">
      {!officialRatesEnabled && (
        <div role="status" className="rounded-lg border border-(--color-warning) bg-(--color-warning-tint) px-4 py-3 text-sm text-(--color-text)">
          <p className="font-medium">Datos manuales en conciliación</p>
          <p className="mt-1 text-(--color-text-muted)">
            Las tasas legales están ocultas y el cierre de períodos está bloqueado hasta contar con el registro fuente de incidentes, lesionados y días de cargo.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Faena" />
          </SelectTrigger>
          <SelectContent>
            {worksites.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
            <SelectItem value="total">— Total (todas) —</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={handleYearChange}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Año" />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="graficos">Gráficos</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {officialRatesEnabled && <KpiCard icon={<Gauge size={18} />} label="Tasa de Frecuencia" value={fmtRate(totalsRates.tasaFrecuencia)} detail="Lesionados × 1M / HH" />}
            {officialRatesEnabled && <KpiCard icon={<Heartbeat size={18} />} label="Tasa de Gravedad" value={fmtRate(totalsRates.tasaGravedad)} detail="Días ausencia/cargo × 1M / HH" />}
            <KpiCard icon={<WarningDiamond size={18} />} label="Total Accidentes" value={String(totalsRates.totalAccidentes)} detail="Dato manual no conciliado" />
            <KpiCard icon={<Siren size={18} />} label="Total Incidentes" value={String(totals.incidentes)} detail="Dato manual no conciliado" />
            {!officialRatesEnabled && <KpiCard icon={<Wrench size={18} />} label="Daño Material" value={String(totals.danoMaterial)} detail="Dato manual no conciliado" />}
            {!officialRatesEnabled && <KpiCard icon={<Drop size={18} />} label="Daño Ambiental" value={String(totals.danoAmbiental)} detail="Dato manual no conciliado" />}
          </div>

          <div className="divide-y divide-(--color-border) border-y border-(--color-border) lg:hidden">
            {monthlyCounters.map((counters, i) => {
              const rates = calcRates(counters)
              const isClosed = closedPeriodKeys.includes(`${selectedWorksiteId}:${i + 1}`)
              const editable = canManage && !isTotalView && (!isClosed || canClose)
              const hasMonthRecord = editable && indicatorRows.some((row) => (
                row.worksiteId === selectedWorksiteId && row.year === year && row.month === i + 1
              ))

              return (
                <section key={MONTHS[i]} className="py-4" aria-label={`${MONTHS[i]} ${year}`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-(--color-text)">{MONTHS[i]}</h3>
                    {editable && <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant={hasMonthRecord ? "ghost" : "secondary"} onClick={() => setEditingMonth(i + 1)}>
                        <Pencil size={14} /> {hasMonthRecord ? "Editar" : "Registrar"}
                      </Button>
                      {isClosed ? <span className="text-xs font-medium text-text-subtle">Cerrado</span> : canClose && <IndicatorPeriodCloseButton worksiteId={selectedWorksiteId} year={year} month={i + 1} />}
                    </div>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><dt className="text-text-subtle">Trabajadores</dt><dd className="font-medium tabular-nums">{counters.trabajadores}</dd></div>
                    <div><dt className="text-text-subtle">Horas hombre</dt><dd className="font-medium tabular-nums">{fmtNum(counters.horasHombre)}</dd></div>
                    <div><dt className="text-text-subtle">Accidentes</dt><dd className="font-medium tabular-nums">{counters.accConTiempoPerdido} c/TP · {counters.accSinTiempoPerdido} s/TP</dd></div>
                    <div><dt className="text-text-subtle">Incidentes</dt><dd className="font-medium tabular-nums">{counters.incidentes}</dd></div>
                    {officialRatesEnabled && <div><dt className="text-text-subtle">Tasa de frecuencia</dt><dd className="font-medium tabular-nums">{fmtRate(rates.tasaFrecuencia)}</dd></div>}
                    {officialRatesEnabled && <div><dt className="text-text-subtle">Tasa de gravedad</dt><dd className="font-medium tabular-nums">{fmtRate(rates.tasaGravedad)}</dd></div>}
                  </dl>
                </section>
              )
            })}
          </div>

          <div className="hidden lg:block">
            <Card>
              <CardContent className="p-0">
              {!isTotalView && !hasRecordsForSelection && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-border) px-4 py-3">
                  <p className="text-sm text-(--color-text-muted)">
                    Sin registros para {selectedWorksiteName ?? "esta faena"} en {year}.
                  </p>
                  {canManage && (
                    <Button type="button" size="sm" onClick={() => setEditingMonth(suggestedMonth)}>
                      {year === currentYear ? `Registrar mes actual · ${suggestedMonthLabel}` : `Registrar ${suggestedMonthLabel}`}
                    </Button>
                  )}
                </div>
              )}
              <TableRoot>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead title="Trabajadores promedio del mes">Trab.</TableHead>
                      <TableHead title="Horas hombre trabajadas">HH</TableHead>
                      <TableHead title="Accidentes con tiempo perdido">Acc. c/TP</TableHead>
                      <TableHead title="Accidentes sin tiempo perdido">Acc. s/TP</TableHead>
                      <TableHead title="Días perdidos por accidentes">Días Perd.</TableHead>
                      <TableHead>Incidentes</TableHead>
                      <TableHead title="Incidentes con daño material">D. Material</TableHead>
                      <TableHead title="Incidentes con daño ambiental">D. Ambiental</TableHead>
                      {officialRatesEnabled && <TableHead title="Tasa de frecuencia legal">Tasa Frec.</TableHead>}
                      {officialRatesEnabled && <TableHead title="Tasa de gravedad legal">Tasa Grav.</TableHead>}
                      <TableHead title="Total de accidentes (con y sin tiempo perdido)">Total Acc.</TableHead>
                      {canManage && !isTotalView && <TableHead className="text-right">Acción</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyCounters.map((counters, i) => {
                      const rates = calcRates(counters)
                      const isClosed = closedPeriodKeys.includes(`${selectedWorksiteId}:${i + 1}`)
                      const editable = canManage && !isTotalView && (!isClosed || canClose)
                      const hasMonthRecord = editable && indicatorRows.some((row) => (
                        row.worksiteId === selectedWorksiteId && row.year === year && row.month === i + 1
                      ))
                      return (
                        <TableRow
                          key={MONTHS[i]}
                        >
                          <TableCell className="font-medium whitespace-nowrap">
                            {MONTHS[i]}
                          </TableCell>
                          <TableCellNum>{counters.trabajadores}</TableCellNum>
                          <TableCellNum>{fmtNum(counters.horasHombre)}</TableCellNum>
                          <TableCellNum>{counters.accConTiempoPerdido}</TableCellNum>
                          <TableCellNum>{counters.accSinTiempoPerdido}</TableCellNum>
                          <TableCellNum>{counters.diasPerdidos}</TableCellNum>
                          <TableCellNum>{counters.incidentes}</TableCellNum>
                          <TableCellNum>{counters.danoMaterial}</TableCellNum>
                          <TableCellNum>{counters.danoAmbiental}</TableCellNum>
                          {officialRatesEnabled && <TableCellNum className="font-semibold">{fmtRate(rates.tasaFrecuencia)}</TableCellNum>}
                          {officialRatesEnabled && <TableCellNum className="font-semibold">{fmtRate(rates.tasaGravedad)}</TableCellNum>}
                          <TableCellNum className="font-semibold">{rates.totalAccidentes}</TableCellNum>
                          {editable && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button type="button" size="sm" variant={hasMonthRecord ? "ghost" : "secondary"} onClick={() => setEditingMonth(i + 1)}>
                                  <Pencil size={14} /> {hasMonthRecord ? "Editar" : "Registrar"}
                                </Button>
                                {isClosed ? <span className="self-center text-xs font-medium text-text-subtle">Cerrado</span> : canClose && <IndicatorPeriodCloseButton worksiteId={selectedWorksiteId} year={year} month={i + 1} />}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>TOTAL ANUAL</TableCell>
                      <TableCellNum>{Math.round(totals.trabajadores / 12)}</TableCellNum>
                      <TableCellNum>{fmtNum(totals.horasHombre)}</TableCellNum>
                      <TableCellNum>{totals.accConTiempoPerdido}</TableCellNum>
                      <TableCellNum>{totals.accSinTiempoPerdido}</TableCellNum>
                      <TableCellNum>{totals.diasPerdidos}</TableCellNum>
                      <TableCellNum>{totals.incidentes}</TableCellNum>
                      <TableCellNum>{totals.danoMaterial}</TableCellNum>
                      <TableCellNum>{totals.danoAmbiental}</TableCellNum>
                      {officialRatesEnabled && <TableCellNum>{fmtRate(totalsRates.tasaFrecuencia)}</TableCellNum>}
                      {officialRatesEnabled && <TableCellNum>{fmtRate(totalsRates.tasaGravedad)}</TableCellNum>}
                      <TableCellNum>{totalsRates.totalAccidentes}</TableCellNum>
                      {canManage && !isTotalView && <TableCell />}
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableRoot>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="graficos">
          <IndicadoresCharts monthlyCounters={monthlyCounters} showOfficialRates={officialRatesEnabled} />
        </TabsContent>
      </Tabs>

      {editingMonth !== null && canManage && !isTotalView && (
        <IndicadoresEditModal
          key={editingMonth}
          worksiteId={selectedWorksiteId}
          year={year}
          month={editingMonth}
          initial={monthlyCounters[editingMonth - 1] as IndicatorCounters}
          showOfficialRates={officialRatesEnabled}
          onClose={() => setEditingMonth(null)}
          onNavigate={(month) => setEditingMonth(month)}
        />
      )}
    </div>
  )
}
