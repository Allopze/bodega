"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CanonicalIndicatorResult } from "@/lib/prevention/safety-indicators-calc"
import type { CanonicalIndicatorYearView } from "@/lib/services/prevention-indicadores"
import { denominatorDialogLabel, IndicatorDenominatorDialog } from "./indicator-denominator-dialog"
import { IndicatorPeriodCloseButton } from "./indicator-period-close-button"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
/**
 * La tabla de denominadores pintaba `reconciliationStatus` y `status` crudos
 * mientras el fallback textual sí estaba en español: la misma columna alternaba
 * idioma según hubiera registro o no, en la pantalla de indicadores DS 44.
 */
const RECONCILIATION_LABELS: Record<string, string> = {
  pending: "Pendiente",
  matched: "Conciliado",
  mismatched: "Con diferencia",
  missing_legacy: "Sin dato anterior",
  difference: "Con diferencia",
  match: "Coincide",
}

const DENOMINATOR_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  submitted: "Enviado",
  approved: "Aprobado",
  rejected: "Rechazado",
}

function labelOrRaw(catalog: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—"
  return catalog[value] ?? value
}

const STATUS_LABELS: Record<string, string> = { reconciled: "Conciliado", provisional: "Provisional", non_calculable: "No calculable", error: "Error de conciliación" }

function rate(value: number | null) {
  return value === null ? "No calculable" : value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Variante para celdas de tabla. La leyenda "No calculable" se explica UNA vez
 * en el aviso sobre la tabla; repetirla en 36 celdas es tinta sin información
 * (Tufte) y no le dice al usuario qué hacer. En la celda basta un guión tenue.
 */
function rateCell(value: number | null) {
  return value === null
    ? <span className="text-[var(--color-text-subtle)]" title="No calculable: falta el denominador del período">—</span>
    : value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  const [editingMonth, setEditingMonth] = useState<number | null>(null)
  const group = view.groups.find((item) => item.worksiteId === selectedWorksiteId) ?? view.groups[0]
  const denominatorByPeriod = useMemo(() => new Map(view.denominators.map((item) => [`${item.worksiteId}:${item.month}`, item])), [view.denominators])
  const closedKeys = useMemo(() => new Set(view.closedPeriods.map((item) => `${item.worksiteId}:${item.month}`)), [view.closedPeriods])
  const latestMonth = useMemo(() => {
    if (!group) return 1
    for (let month = 12; month >= 1; month--) if (group.monthly[month - 1]?.denominatorSlots) return month
    return Math.min(new Date().getMonth() + 1, 12)
  }, [group])
  if (!group) return <EmptyState title="Sin faenas visibles" description="Asigna una faena al usuario para calcular indicadores dentro de su alcance." action={<Button asChild variant="secondary" size="sm"><Link href="/admin/usuarios">Gestionar asignaciones</Link></Button>} />
  const currentMonth = group.monthly[latestMonth - 1]!
  const currentSemester = group.semesters[latestMonth <= 6 ? 0 : 1]!
  const selectedIsTotal = group.worksiteId === "total"
  const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - index)
  if (!yearOptions.includes(view.year)) yearOptions.push(view.year)
  const pendingCount = group.monthly.reduce((total, item) => total + item.pendingCaseCount, 0)
  const hasCriticalReconciliation = group.monthly.some((item) => item.status === "error")
  // Un indicador es no-calculable cuando falta el denominador (HH) del período.
  const monthsWithoutHours = group.monthly.filter((item) => !item.workedHours)
  const firstMonthWithoutHours = group.monthly.findIndex((item) => !item.workedHours) + 1

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
        <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}><SelectTrigger aria-label="Faena" className="w-64"><SelectValue /></SelectTrigger><SelectContent>{view.groups.map((item) => <SelectItem key={item.worksiteId} value={item.worksiteId}>{item.worksiteName}</SelectItem>)}</SelectContent></Select>
        <Select value={String(view.year)} onValueChange={(value) => router.replace(`/prevencion/indicadores?year=${value}`, { scroll: false })}><SelectTrigger aria-label="Año" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{yearOptions.sort((a, b) => b - a).map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        <Link href={incidentHref(group.annual, "accidentability")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Accidentabilidad anual</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(group.annual, "accidentabilityRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Accidentes × 100 / dotación promedio</span></Link>
        <Link href={incidentHref(currentMonth, "frequency")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Frecuencia · {MONTHS[latestMonth - 1]}</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(currentMonth, "frequencyRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Lesionados × 1.000.000 / HH</span></Link>
        <Link href={incidentHref(currentSemester, "severity")} className="border-r border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Gravedad · S{latestMonth <= 6 ? "1" : "2"}</span><span className="mt-1 block font-mono text-xl font-semibold">{rate(metricValue(currentSemester, "severityRate"))}</span><span className="text-xs text-[var(--color-text-subtle)]">Ausencia + cargo × 1.000.000 / HH</span></Link>
        <Link href={incidentHref(group.annual, "pending")} className="px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Casos por calificar</span><span className="mt-1 block font-mono text-xl font-semibold">{pendingCount}</span><span className="text-xs text-[var(--color-text-subtle)]">Bloquean aprobación</span></Link>
      </div>

      <Tabs defaultValue="monthly">
        <TabsList><TabsTrigger value="monthly">Cálculo mensual</TabsTrigger><TabsTrigger value="denominators">Denominadores</TabsTrigger><TabsTrigger value="reconciliation">Datos del sistema anterior</TabsTrigger></TabsList>
        <TabsContent value="monthly" className="space-y-4">
          {/* A-4: una sola explicación accionable en vez de repetir "No calculable"
              en 36 celdas. Dice QUÉ falta, CUÁNTO falta y ofrece el CTA que lo
              resuelve — el mismo diálogo que ya existía enterrado por fila. */}
          {monthsWithoutHours.length > 0 && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-[var(--color-warning-ink)]">
                  {monthsWithoutHours.length === 12
                    ? `Sin denominadores cargados para ${view.year}`
                    : `Faltan denominadores en ${monthsWithoutHours.length} de 12 meses`}
                </p>
                <p className="mt-0.5 text-[var(--color-text-muted)]">
                  Las tasas de frecuencia, gravedad y accidentabilidad se calculan sobre las horas-hombre
                  del período. Sin ese dato el mes aparece como «—» y no puede cerrarse.
                </p>
              </div>
              {selectedIsTotal ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Selecciona una faena para cargarlos.
                </p>
              ) : (
                canManage && (
                  <Button type="button" size="sm" onClick={() => setEditingMonth(firstMonthWithoutHours)}>
                    Cargar dotación y HH
                  </Button>
                )
              )}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table><TableHeader><TableRow><TableHead>Mes / estado</TableHead><TableHead className="text-right">Lesionados</TableHead><TableHead className="text-right">HH</TableHead><TableHead className="text-right">Frecuencia</TableHead><TableHead className="text-right">Ausencia + cargo</TableHead><TableHead className="text-right">Accidentabilidad</TableHead>{!selectedIsTotal && (canManage || canClose) && <TableHead className="text-right">Acción</TableHead>}</TableRow></TableHeader>
              <TableBody>{group.monthly.map((item, index) => {
                const denominator = selectedIsTotal ? null : denominatorByPeriod.get(`${group.worksiteId}:${index + 1}`) ?? null
                const closed = !selectedIsTotal && closedKeys.has(`${group.worksiteId}:${index + 1}`)
                const metrics = item.status === "provisional" ? item.provisional : item.confirmed
                return <TableRow key={MONTHS[index]}><TableCell><p className="font-medium">{MONTHS[index]}</p><MetaBadge className="mt-1" meta={{ label: STATUS_LABELS[item.status] ?? item.status, variant: statusVariant(item.status) }} />{item.pendingCaseCount > 0 && <p className="mt-1 text-xs text-[var(--color-warning-ink)]">{item.pendingCaseCount} pendiente(s)</p>}</TableCell><TableCell className="text-right font-mono tabular-nums"><Link href={incidentHref(item, "frequency")} className="font-medium text-[var(--color-primary-ink)] hover:underline">{metrics.injuredPeople}</Link></TableCell><TableCell className="text-right font-mono tabular-nums">{item.workedHours ? item.workedHours.toLocaleString("es-CL") : <span className="text-[var(--color-text-subtle)]" title="Sin denominador cargado para este mes">—</span>}</TableCell><TableCell className="text-right font-mono tabular-nums font-medium">{rateCell(metricValue(item, "frequencyRate"))}</TableCell><TableCell className="text-right font-mono tabular-nums">{metrics.absenceDays} + {metrics.chargeDays}</TableCell><TableCell className="text-right font-mono tabular-nums">{rateCell(metricValue(item, "accidentabilityRate"))}</TableCell>{!selectedIsTotal && (canManage || canClose) && <TableCell className="text-right"><div className="flex justify-end gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setEditingMonth(index + 1)}>{denominatorDialogLabel(denominator ?? null)}</Button>{closed ? <MetaBadge meta={{ label: "Cerrado", variant: "success" }} /> : canClose && item.status === "reconciled" && <IndicatorPeriodCloseButton worksiteId={String(group.worksiteId)} year={view.year} month={index + 1} />}</div></TableCell>}</TableRow>
              })}</TableBody></Table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">{group.semesters.map((semester, index) => <div key={`semester-${index + 1}`} className="rounded-lg border border-[var(--color-border)] p-4"><div className="flex justify-between"><h3 className="font-medium">Semestre {index + 1}</h3><MetaBadge meta={{ label: STATUS_LABELS[semester.status] ?? semester.status, variant: statusVariant(semester.status) }} /></div><p className="mt-3 font-mono text-2xl font-semibold">{rate(metricValue(semester, "severityRate"))}</p><p className="text-xs text-[var(--color-text-subtle)]">Calculada desde los seis meses brutos, no desde un promedio de tasas.</p></div>)}</div>
          {group.annual.sexBreakdown.length > 0 && <div className="rounded-lg border border-[var(--color-border)] p-4"><h3 className="font-medium">Desagregación por sexo</h3><div className="mt-3 flex flex-wrap gap-4 text-sm">{group.annual.sexBreakdown.map((item) => <p key={item.sex}><span className="text-[var(--color-text-subtle)]">{item.sex}:</span> {item.suppressed ? "Oculto por grupo pequeño (<5)" : item.value}</p>)}</div></div>}
        </TabsContent>

        <TabsContent value="denominators">
          {selectedIsTotal ? <EmptyState title="Selecciona una faena" description="La fuente y aprobación se gestionan por faena y mes; la vista total sólo agrega resultados autorizados." /> : <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]"><Table><TableHeader><TableRow><TableHead>Mes</TableHead><TableHead className="text-right">Dotación</TableHead><TableHead className="text-right">HH</TableHead><TableHead>Fuente</TableHead><TableHead>Conciliación</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{MONTHS.map((month, index) => { const item = denominatorByPeriod.get(`${group.worksiteId}:${index + 1}`) ?? null; return <TableRow key={month}><TableCell>{month}</TableCell><TableCell className="text-right font-mono tabular-nums">{item?.workerCount ?? "—"}</TableCell><TableCell className="text-right font-mono tabular-nums">{item?.workedHours?.toLocaleString("es-CL") ?? "—"}</TableCell><TableCell>{item?.sourceReference ?? "Sin fuente"}</TableCell><TableCell><MetaBadge meta={{ label: item ? labelOrRaw(RECONCILIATION_LABELS, item.reconciliationStatus) : "Pendiente", variant: statusVariant(item?.reconciliationStatus ?? "pending") }} /></TableCell><TableCell><MetaBadge meta={{ label: item ? labelOrRaw(DENOMINATOR_STATUS_LABELS, item.status) : "Sin registro", variant: statusVariant(item?.status ?? "draft") }} /></TableCell><TableCell className="text-right"><Button type="button" size="sm" variant="ghost" onClick={() => setEditingMonth(index + 1)}>{denominatorDialogLabel(item)}</Button></TableCell></TableRow> })}</TableBody></Table></div>}
        </TabsContent>

        <TabsContent value="reconciliation">
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]"><Table><TableHeader><TableRow><TableHead>Mes</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">HH anterior → actual</TableHead><TableHead className="text-right">Accidentes anterior → actual</TableHead><TableHead className="text-right">Días anterior → ausencia+cargo</TableHead></TableRow></TableHeader><TableBody>{group.monthly.map((item, index) => { const comparison = item.legacyComparison; return <TableRow key={MONTHS[index]}><TableCell>{MONTHS[index]}</TableCell><TableCell><MetaBadge meta={{ label: comparison.status === "match" ? "Cuadra" : comparison.status === "difference" ? "Diferencia" : "Sin datos anteriores", variant: comparison.status === "match" ? "success" : comparison.status === "difference" ? "warning" : "default" }} /></TableCell><TableCell className="text-right font-mono tabular-nums">{comparison.legacy?.horasHombre ?? "—"} → {comparison.derived.horasHombre}</TableCell><TableCell className="text-right font-mono tabular-nums">{comparison.legacy?.accConTiempoPerdido ?? "—"} → {comparison.derived.accConTiempoPerdido}</TableCell><TableCell className="text-right font-mono tabular-nums">{comparison.legacy?.diasPerdidos ?? "—"} → {comparison.derived.diasPerdidos}</TableCell></TableRow> })}</TableBody></Table></div>
        </TabsContent>
      </Tabs>
      {editingMonth !== null && !selectedIsTotal && (
        <IndicatorDenominatorDialog
          key={editingMonth}
          worksiteId={String(group.worksiteId)}
          year={view.year}
          month={editingMonth}
          denominator={denominatorByPeriod.get(`${group.worksiteId}:${editingMonth}`) ?? null}
          canManage={canManage}
          canApprove={canClose}
          currentUserId={currentUserId}
          onClose={() => setEditingMonth(null)}
          onNavigate={setEditingMonth}
        />
      )}
    </div>
  )
}
