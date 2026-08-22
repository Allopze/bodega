import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { requirePermission } from "@/lib/auth/can"
import { getOperationalControlHub, resolveOperationalControlPeriod } from "@/lib/services/operational-control"
import { formatCLP, formatDateTime } from "@/lib/utils"
import { OperationalAssetsTable } from "./operational-assets-table"
import { OperationalExportButton } from "./operational-export-button"

export const metadata: Metadata = { title: "Control operacional" }
const metric = (value: number | null, suffix = "") => value == null ? "Sin datos" : `${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}${suffix}`

export default async function OperationalControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = resolveOperationalControlPeriod({ from: typeof sp.desde === "string" ? sp.desde : undefined, to: typeof sp.hasta === "string" ? sp.hasta : undefined })
  const data = await getOperationalControlHub(session, period)
  return <PageContainer>
    <PageHeader title="Control operacional" description={`Salud, trabajo pendiente y desempeño de activos entre ${period.from} y ${period.to}.`} breadcrumb={<Breadcrumbs items={[{ label: "Control operacional" }]} />} actions={<div className="flex gap-2"><OperationalExportButton period={period} />{data.permissions.canViewMaintenance && <Button asChild><Link href="/mantenciones">Gestionar OT</Link></Button>}</div>} />
    <Card className="mb-4"><CardContent className="pt-6"><form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="Desde" htmlFor="operational-from"><DatePicker id="operational-from" name="desde" defaultValue={period.from} /></Field><Field label="Hasta" htmlFor="operational-to"><DatePicker id="operational-to" name="hasta" defaultValue={period.to} /></Field><Button type="submit" className="self-end">Aplicar período</Button></form></CardContent></Card>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Disponibilidad" value={metric(data.metrics.availabilityPercent, "%")} /><MetricCard label="MTBF" value={metric(data.metrics.mtbfHours, " h")} /><MetricCard label="MTTR" value={metric(data.metrics.mttrHours, " h")} /><MetricCard label="Cumplimiento preventivo" value={metric(data.metrics.preventiveCompliancePercent, "%")} /></div>
    <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-[var(--color-border)] bg-white px-5 py-3 text-sm"><span><strong>{metric(data.metrics.downtimeHours, " h")}</strong> de detención</span><span><strong>{data.metrics.backlog.toLocaleString("es-CL")}</strong> OT abiertas</span>{data.permissions.canViewCosts && <span><strong>{formatCLP(data.metrics.maintenanceCost ?? 0)}</strong> en mantenciones</span>}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>Activos y trabajo del período</CardTitle></CardHeader><CardContent><OperationalAssetsTable assets={data.assets} canViewCosts={data.permissions.canViewCosts} /></CardContent></Card><Card><CardHeader><CardTitle>Salud de fuentes</CardTitle></CardHeader><CardContent><ul className="space-y-3">{data.sourceHealth.map((source) => <li key={source.key} className="rounded-lg border border-[var(--color-border)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{source.label}</span><Badge variant={source.status === "importado" ? "success" : source.status === "sin_ejecucion" ? "outline" : "warning"}>{source.status}</Badge></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">{source.detail}</p><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{source.lastRunAt ? formatDateTime(source.lastRunAt) : "Sin ejecución visible"}</p></li>)}</ul></CardContent></Card></div>
  </PageContainer>
}

function MetricCard({ label, value }: { label: string; value: string }) { return <Card><CardContent className="pt-5"><p className="text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card> }
