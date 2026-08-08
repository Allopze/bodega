import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getTaeCopecReconciliation, type TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TaeCopecExportButton } from "./export-button"
import { FilterSelect } from "../../filter-select"

export const metadata: Metadata = { title: "Conciliación TAE–TCT" }

const COVERAGE = {
  both_channels: { label: "Ambos", variant: "primary" as const },
  tae_only: { label: "Solo TAE", variant: "warning" as const },
  tct_only: { label: "Solo TCT", variant: "info" as const },
}

export default async function TaeCopecReconciliationPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; faena?: string }> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view") } catch { redirect("/forbidden") }
  const raw = await searchParams
  const filters: TaeCopecFilters = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(raw.desde ?? "") ? raw.desde : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(raw.hasta ?? "") ? raw.hasta : undefined,
    worksiteId: raw.faena || undefined,
  }
  const scope = resolveWorksiteScope(session)
  const [data, worksiteRows] = await Promise.all([
    getTaeCopecReconciliation(session, filters),
    scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({ where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined, columns: { id: true, name: true }, orderBy: [worksites.name] }),
  ])
  return <PageContainer>
    <PageHeader title="Conciliación TAE–Copec TCT" description="Cobertura mensual por equipo: carga física TAE, Diésel TCT y BlueMax TCT como canales independientes." breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Conciliación" }]} />} actions={<TaeCopecExportButton filters={filters} />} />
    <section className="mb-5 border border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] p-4 text-sm text-[var(--color-primary-ink)]"><strong>Cómo leerla:</strong> TAE y TCT no son documentos espejo. “Ambos” indica que el equipo usó los dos canales en el mes; no implica una diferencia contable. TAE todavía no clasifica producto, por lo que sus litros se muestran separados de Diésel y BlueMax.</section>
    <form method="get" className="mb-5 grid gap-3 border border-(--color-border) bg-(--color-surface-2) p-4 sm:grid-cols-4 sm:items-end"><div><Label htmlFor="recon-from">Desde</Label><DatePicker id="recon-from" name="desde" defaultValue={filters.from} placeholder="Desde" /></div><div><Label htmlFor="recon-to">Hasta</Label><DatePicker id="recon-to" name="hasta" defaultValue={filters.to} placeholder="Hasta" /></div><div><Label htmlFor="recon-worksite">Faena</Label><FilterSelect name="faena" defaultValue={filters.worksiteId ?? ""} ariaLabel="Filtrar conciliación por faena" options={worksiteRows.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas" /></div><div className="flex gap-2"><Button type="submit" size="sm">Aplicar</Button><Button asChild type="button" variant="ghost" size="sm"><Link href="/combustibles/tae/conciliacion">Limpiar</Link></Button></div></form>
    <section className="mb-5 grid grid-cols-2 gap-px border border-(--color-border) bg-(--color-border) lg:grid-cols-4"><div className="bg-(--color-surface) p-4"><p className="text-eyebrow">TAE</p><p className="mt-1 font-mono text-xl">{data.summary.taeLiters.toLocaleString("es-CL")} L</p></div><div className="bg-(--color-surface) p-4"><p className="text-eyebrow">TCT Diésel</p><p className="mt-1 font-mono text-xl">{data.summary.tctDieselLiters.toLocaleString("es-CL")} L</p></div><div className="bg-(--color-surface) p-4"><p className="text-eyebrow">TCT BlueMax</p><p className="mt-1 font-mono text-xl">{data.summary.tctBlueMaxLiters.toLocaleString("es-CL")} L</p></div><div className="bg-(--color-surface) p-4"><p className="text-eyebrow">Cobertura</p><p className="mt-1 text-sm">{data.summary.bothChannels} ambos · {data.summary.taeOnly} TAE · {data.summary.tctOnly} TCT</p></div></section>
    {(data.summary.unmappedTaeLoads > 0 || data.summary.unmappedTctRecords > 0) && <section className="mb-5 border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4 text-sm text-[var(--color-warning-ink)]"><strong>Fuera de conciliación:</strong> {data.summary.unmappedTaeLoads} cargas TAE ({data.summary.unmappedTaeLiters.toLocaleString("es-CL")} L) y {data.summary.unmappedTctRecords} registros TCT ({data.summary.unmappedTctLiters.toLocaleString("es-CL")} L) sin equipo asociado.</section>}
    {data.rows.some((row) => row.tctPartial) && <p className="mb-2 text-xs text-(--color-text-muted)"><Badge variant="outline" size="sm">Parcial</Badge> = hay un registro TCT del período que se extiende más allá del rango filtrado; sus litros no se incluyen en el total para no sobreestimarlo. Amplía el rango de fechas para verlos completos.</p>}
    <div className="overflow-x-auto border border-(--color-border)"><Table className="min-w-[980px]"><TableHeader><TableRow><TableHead>Mes</TableHead><TableHead>Faena</TableHead><TableHead>Equipo</TableHead><TableHead>TAE</TableHead><TableHead>TCT Diésel</TableHead><TableHead>TCT BlueMax</TableHead><TableHead>Total</TableHead><TableHead>Cobertura</TableHead></TableRow></TableHeader><TableBody>{data.rows.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-(--color-text-muted)">No hay datos TAE/TCT conciliables para estos filtros.</TableCell></TableRow> : data.rows.map((row) => <TableRow key={`${row.month}:${row.worksiteId}:${row.vehicleId}`}><TableCell className="font-mono">{row.month}</TableCell><TableCell>{row.worksiteName}</TableCell><TableCell><span className="font-medium">{row.equipment}</span><span className="block text-xs text-(--color-text-muted)">{row.plate}</span></TableCell><TableCell className="font-mono text-right">{row.taeLiters.toLocaleString("es-CL")} L<span className="block text-xs text-(--color-text-muted)">{row.taeLoads} cargas</span></TableCell><TableCell className="font-mono text-right">{row.tctDieselLiters.toLocaleString("es-CL")} L</TableCell><TableCell className="font-mono text-right">{row.tctBlueMaxLiters.toLocaleString("es-CL")} L</TableCell><TableCell className="font-mono text-right font-semibold">{row.totalLiters.toLocaleString("es-CL")} L</TableCell><TableCell className="flex flex-wrap gap-1"><Badge variant={COVERAGE[row.coverage].variant}>{COVERAGE[row.coverage].label}</Badge>{row.tctPartial && <Badge variant="outline" size="sm">Parcial</Badge>}</TableCell></TableRow>)}</TableBody></Table></div>
  </PageContainer>
}
