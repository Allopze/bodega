"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CanonicalIndicatorResult } from "@/lib/prevention/safety-indicators-calc"
import type { CanonicalIndicatorYearView } from "@/lib/services/prevention-indicadores"
import { IndicatorDenominatorDialog } from "./indicator-denominator-dialog"
import { IndicatorPeriodCloseButton } from "./indicator-period-close-button"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const STATUS_LABELS: Record<string, string> = { reconciled: "Conciliado", provisional: "Provisional", non_calculable: "No calculable", error: "Error de conciliación" }

function rate(value: number | null) {
  return value === null ? "No calculable" : value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "reconciled" || status === "approved") return "success"
  if (status === "error" || status === "rejected") return "danger"
  if (["provisional", "pending_review", "difference", "reopened"].includes(status)) return "warning"
  return "default"
}

function metricValue(result: CanonicalIndicatorResult, key: "accidentabilityRate" | "frequencyRate" | "severityRate") {
  return result.status === "provisional" ? result.provisional[key] : result.confirmed[key]
}

export function CanonicalIndicatorsDashboard({ view, currentYear, canManage, canClose, currentUserId }: {
  view: CanonicalIndicatorYearView
  currentYear: number
  canManage: boolean
  canClose: boolean
  currentUserId: string
}) {
  const router = useRouter()
  const [selectedWorksiteId, setSelectedWorksiteId] = useState(view.groups.find((item) => item.worksiteId === "total")?.worksiteId ?? view.groups[0]?.worksiteId ?? "")
  const group = view.groups.find((item) => item.worksiteId === selectedWorksiteId) ?? view.groups[0]
  const denominatorByPeriod = useMemo(() => new Map(view.denominators.map((item) => [`${item.worksiteId}:${item.month}`, item])), [view.denominators])
  const closedKeys = useMemo(() => new Set(view.closedPeriods.map((item) => `${item.worksiteId}:${item.month}`)), [view.closedPeriods])
  const latestMonth = useMemo(() => {
    if (!group) return 1
    for (let month = 12; month >= 1; month--) if (group.monthly[month - 1]?.denominatorSlots) return month
    return Math.min(new Date().getMonth() + 1, 12)
  }, [group])
  if (!group) return <EmptyState title="Sin faenas visibles" description="Asigna una faena al usuario para calcular indicadores dentro de su alcance." />
  const currentMonth = group.monthly[latestMonth - 1]!
  const currentSemester = group.semesters[latestMonth <= 6 ? 0 : 1]!
  const selectedIsTotal = group.worksiteId === "total"
  const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - index)
  if (!yearOptions.includes(view.year)) yearOptions.push(view.year)
  const pendingCount = group.monthly.reduce((total, item) => total + item.pendingCaseCount, 0)
  const hasCriticalReconciliation = group.monthly.some((item) => item.status === "error")

  function incidentHref(result: CanonicalIndicatorResult, indicator: string) {
    const params = new URLSearchParams({ year: String(view.year), monthFrom: String(result.startMonth), monthTo: String(result.endMonth), indicator })
    if (!selectedIsTotal) params.set("worksiteId", selectedWorksiteId)
    return `/prevencion/incidentes?${params}`
  }

  return (
    <div className="space-y-4">
      <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${hasCriticalReconciliation ? "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)]" : "border-[var(--color-info-line)] bg-[var(--color-info-tint)]"}`}>
        <p className="font-medium">Motor canónico · {group.worksiteName}</p>
        <p className="mt-1 text-[var(--color-text-subtle)]">DS 44 art. 73 · fórmula {group.annual.formulaVersion}. Los casos pendientes se muestran como provisionales y no permiten cerrar el período.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}><SelectTrigger className="w-64"><SelectValue /></SelectTrigger><SelectContent>{view.groups.map((item) => <SelectItem key={item.worksiteId} value={item.worksiteId}>{item.worksiteName}</SelectItem>)}</SelectContent></Select>
        <Select value={String(view.year)} onValueChange={(value) => router.push(`/prevencion/indicadores?year=${value}`)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{yearOptions.sort((a, b) => b - a).map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        <Link href={incidentHref(group.annual, "accidentability")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Accidentabilidad anual</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(group.annual, "accidentabilityRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Accidentes × 100 / dotación promedio</span></Link>
        <Link href={incidentHref(currentMonth, "frequency")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Frecuencia · {MONTHS[latestMonth - 1]}</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(currentMonth, "frequencyRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Lesionados × 1.000.000 / HH</span></Link>
        <Link href={incidentHref(currentSemester, "severity")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Gravedad · S{latestMonth <= 6 ? "1" : "2"}</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(currentSemester, "severityRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Ausencia + cargo × 1.000.000 / HH</span></Link>
        <Link href={incidentHref(group.annual, "pending")} className="px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Casos por calificar</span><span className="mt-1 block font-mono text-xl font-semibold">{pendingCount}</span><span className="text-xs text-[var(--color-text-subtle)]">Bloquean aprobación</span></Link>
      </div>

      <Tabs defaultValue="monthly">
        <TabsList><TabsTrigger value="monthly">Cálculo mensual</TabsTrigger><TabsTrigger value="denominators">Denominadores</TabsTrigger><TabsTrigger value="reconciliation">Conciliación legado</TabsTrigger></TabsList>
        <TabsContent value="monthly" className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table><TableHeader><TableRow><TableHead>Mes / estado</TableHead><TableHead>Lesionados</TableHead><TableHead>HH</TableHead><TableHead>Frecuencia</TableHead><TableHead>Ausencia + cargo</TableHead><TableHead>Accidentabilidad</TableHead>{!selectedIsTotal && (canManage || canClose) && <TableHead className="text-right">Acción</TableHead>}</TableRow></TableHeader>
              <TableBody>{group.monthly.map((item, index) => {
                const denominator = selectedIsTotal ? null : denominatorByPeriod.get(`${group.worksiteId}:${index + 1}`) ?? null
                const closed = !selectedIsTotal && closedKeys.has(`${group.worksiteId}:${index + 1}`)
                const metrics = item.status === "provisional" ? item.provisional : item.confirmed
                return <TableRow key={index}><TableCell><p className="font-medium">{MONTHS[index]}</p><Badge className="mt-1" variant={statusVariant(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</Badge>{item.pendingCaseCount > 0 && <p className="mt-1 text-xs text-[var(--color-warning-ink)]">{item.pendingCaseCount} pendiente(s)</p>}</TableCell><TableCell><Link href={incidentHref(item, "frequency")} className="font-medium text-[var(--color-primary-ink)] hover:underline">{metrics.injuredPeople}</Link></TableCell><TableCell>{item.workedHours.toLocaleString("es-CL")}</TableCell><TableCell className="font-medium">{rate(metricValue(item, "frequencyRate"))}</TableCell><TableCell>{metrics.absenceDays} + {metrics.chargeDays}</TableCell><TableCell>{rate(metricValue(item, "accidentabilityRate"))}</TableCell>{!selectedIsTotal && (canManage || canClose) && <TableCell className="text-right"><div className="flex justify-end gap-1"><IndicatorDenominatorDialog worksiteId={String(group.worksiteId)} year={view.year} month={index + 1} denominator={denominator ?? null} canManage={canManage} canApprove={canClose} currentUserId={currentUserId} />{closed ? <Badge variant="success">Cerrado</Badge> : canClose && item.status === "reconciled" && <IndicatorPeriodCloseButton worksiteId={String(group.worksiteId)} year={view.year} month={index + 1} />}</div></TableCell>}</TableRow>
              })}</TableBody></Table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">{group.semesters.map((semester, index) => <div key={index} className="rounded-lg border border-[var(--color-border)] p-4"><div className="flex justify-between"><h3 className="font-medium">Semestre {index + 1}</h3><Badge variant={statusVariant(semester.status)}>{STATUS_LABELS[semester.status]}</Badge></div><p className="mt-3 font-mono text-2xl font-semibold">{rate(metricValue(semester, "severityRate"))}</p><p className="text-xs text-[var(--color-text-subtle)]">Calculada desde los seis meses brutos, no desde un promedio de tasas.</p></div>)}</div>
          {group.annual.sexBreakdown.length > 0 && <div className="rounded-lg border border-[var(--color-border)] p-4"><h3 className="font-medium">Desagregación por sexo</h3><div className="mt-3 flex flex-wrap gap-4 text-sm">{group.annual.sexBreakdown.map((item) => <p key={item.sex}><span className="text-[var(--color-text-subtle)]">{item.sex}:</span> {item.suppressed ? "Oculto por grupo pequeño (<5)" : item.value}</p>)}</div></div>}
        </TabsContent>

        <TabsContent value="denominators">
          {selectedIsTotal ? <EmptyState title="Selecciona una faena" description="La fuente y aprobación se gestionan por faena y mes; la vista total sólo agrega resultados autorizados." /> : <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]"><Table><TableHeader><TableRow><TableHead>Mes</TableHead><TableHead>Dotación</TableHead><TableHead>HH</TableHead><TableHead>Fuente</TableHead><TableHead>Conciliación</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{MONTHS.map((month, index) => { const item = denominatorByPeriod.get(`${group.worksiteId}:${index + 1}`) ?? null; return <TableRow key={month}><TableCell>{month}</TableCell><TableCell>{item?.workerCount ?? "—"}</TableCell><TableCell>{item?.workedHours?.toLocaleString("es-CL") ?? "—"}</TableCell><TableCell>{item?.sourceReference ?? "Sin fuente"}</TableCell><TableCell><Badge variant={statusVariant(item?.reconciliationStatus ?? "pending")}>{item?.reconciliationStatus ?? "Pendiente"}</Badge></TableCell><TableCell><Badge variant={statusVariant(item?.status ?? "draft")}>{item?.status ?? "Sin registro"}</Badge></TableCell><TableCell className="text-right"><IndicatorDenominatorDialog worksiteId={String(group.worksiteId)} year={view.year} month={index + 1} denominator={item} canManage={canManage} canApprove={canClose} currentUserId={currentUserId} /></TableCell></TableRow> })}</TableBody></Table></div>}
        </TabsContent>

        <TabsContent value="reconciliation">
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]"><Table><TableHeader><TableRow><TableHead>Mes</TableHead><TableHead>Estado</TableHead><TableHead>HH legado → canónico</TableHead><TableHead>Accidentes legado → fuente</TableHead><TableHead>Días legado → ausencia+cargo</TableHead><TableHead>Daños / incidentes</TableHead></TableRow></TableHeader><TableBody>{group.monthly.map((item, index) => { const comparison = item.legacyComparison; return <TableRow key={index}><TableCell>{MONTHS[index]}</TableCell><TableCell><Badge variant={comparison.status === "match" ? "success" : comparison.status === "difference" ? "warning" : "default"}>{comparison.status === "match" ? "Cuadra" : comparison.status === "difference" ? "Diferencia" : "Sin legado"}</Badge></TableCell><TableCell>{comparison.legacy?.horasHombre ?? "—"} → {comparison.derived.horasHombre}</TableCell><TableCell>{comparison.legacy?.accConTiempoPerdido ?? "—"} → {comparison.derived.accConTiempoPerdido}</TableCell><TableCell>{comparison.legacy?.diasPerdidos ?? "—"} → {comparison.derived.diasPerdidos}</TableCell><TableCell>{comparison.derived.incidentes} inc. · {comparison.derived.danoMaterial} mat. · {comparison.derived.danoAmbiental} amb.</TableCell></TableRow> })}</TableBody></Table></div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
