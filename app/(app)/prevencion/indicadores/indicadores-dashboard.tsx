"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Pencil } from "@phosphor-icons/react"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableRoot, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCellNum } from "@/components/ui/table"
import { KpiCard } from "@/app/(app)/analitica/analytics-kpi-card"
import { Gauge, Heartbeat, WarningDiamond, Siren, Wrench, Drop } from "@phosphor-icons/react"
import { buildMonthlyCounters, calcRates, sumCounters, type IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"
import type { SafetyIndicator } from "@/db/schema"
import { IndicadoresEditModal } from "./indicadores-edit-modal"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const YEAR_RANGE = 3 // años hacia atrás que se ofrecen en el selector, además del actual
// Recharts usa contextos de React y debe evaluarse exclusivamente en el navegador.
const IndicadoresCharts = dynamic(() => import("./indicadores-charts"), { ssr: false })

function fmtNum(n: number) {
  return n ? n.toLocaleString("es-CL") : "0"
}

export function IndicadoresDashboard({
  worksites,
  indicatorRows,
  year,
  currentYear,
  canManage,
}: {
  worksites: Array<{ id: string; name: string }>
  indicatorRows: SafetyIndicator[]
  year: number
  currentYear: number
  canManage: boolean
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

  function handleYearChange(nextYear: string) {
    router.push(`/prevencion/indicadores?year=${nextYear}`)
  }

  const yearOptions = Array.from({ length: YEAR_RANGE + 1 }, (_, i) => currentYear - i)
  if (!yearOptions.includes(year)) yearOptions.push(year)
  yearOptions.sort((a, b) => b - a)

  return (
    <div className="space-y-4">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={<Gauge size={18} />} label="Tasa de Frecuencia" value={totalsRates.tasaFrecuencia.toFixed(2)} detail="Acc. c/TP × 1M / HH" />
            <KpiCard icon={<Heartbeat size={18} />} label="Tasa de Gravedad" value={totalsRates.tasaGravedad.toFixed(2)} detail="Días perd. × 1.000 / HH" />
            <KpiCard icon={<WarningDiamond size={18} />} label="Total Accidentes" value={String(totalsRates.totalAccidentes)} detail="Con y sin tiempo perdido" />
            <KpiCard icon={<Siren size={18} />} label="Total Incidentes" value={String(totals.incidentes)} detail="Reportados en el año" />
            <KpiCard icon={<Wrench size={18} />} label="Daño Material" value={String(totals.danoMaterial)} detail="Incidentes materiales" />
            <KpiCard icon={<Drop size={18} />} label="Daño Ambiental" value={String(totals.danoAmbiental)} detail="Incidentes ambientales" />
          </div>

          <Card>
            <CardContent className="p-0">
              <TableRoot>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead>Trab.</TableHead>
                      <TableHead>HH</TableHead>
                      <TableHead>Acc. c/TP</TableHead>
                      <TableHead>Acc. s/TP</TableHead>
                      <TableHead>Días Perd.</TableHead>
                      <TableHead>Incidentes</TableHead>
                      <TableHead>D. Material</TableHead>
                      <TableHead>D. Ambiental</TableHead>
                      <TableHead>Tasa Frec.</TableHead>
                      <TableHead>Tasa Grav.</TableHead>
                      <TableHead>Total Acc.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyCounters.map((counters, i) => {
                      const rates = calcRates(counters)
                      const editable = canManage && !isTotalView
                      return (
                        <TableRow
                          key={i}
                          className={editable ? "cursor-pointer" : undefined}
                          onClick={editable ? () => setEditingMonth(i + 1) : undefined}
                        >
                          <TableCell className="font-medium whitespace-nowrap">
                            {MONTHS[i]}
                            {editable && <Pencil size={12} className="ml-2 inline text-[var(--color-text-subtle)]" />}
                          </TableCell>
                          <TableCellNum>{counters.trabajadores}</TableCellNum>
                          <TableCellNum>{fmtNum(counters.horasHombre)}</TableCellNum>
                          <TableCellNum>{counters.accConTiempoPerdido}</TableCellNum>
                          <TableCellNum>{counters.accSinTiempoPerdido}</TableCellNum>
                          <TableCellNum>{counters.diasPerdidos}</TableCellNum>
                          <TableCellNum>{counters.incidentes}</TableCellNum>
                          <TableCellNum>{counters.danoMaterial}</TableCellNum>
                          <TableCellNum>{counters.danoAmbiental}</TableCellNum>
                          <TableCellNum className="font-semibold">{rates.tasaFrecuencia.toFixed(2)}</TableCellNum>
                          <TableCellNum className="font-semibold">{rates.tasaGravedad.toFixed(2)}</TableCellNum>
                          <TableCellNum className="font-semibold">{rates.totalAccidentes}</TableCellNum>
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
                      <TableCellNum>{totalsRates.tasaFrecuencia.toFixed(2)}</TableCellNum>
                      <TableCellNum>{totalsRates.tasaGravedad.toFixed(2)}</TableCellNum>
                      <TableCellNum>{totalsRates.totalAccidentes}</TableCellNum>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableRoot>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="graficos">
          <IndicadoresCharts monthlyCounters={monthlyCounters} />
        </TabsContent>
      </Tabs>

      {editingMonth !== null && canManage && !isTotalView && (
        <IndicadoresEditModal
          worksiteId={selectedWorksiteId}
          year={year}
          month={editingMonth}
          initial={monthlyCounters[editingMonth - 1] as IndicatorCounters}
          onClose={() => setEditingMonth(null)}
        />
      )}
    </div>
  )
}
