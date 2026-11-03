import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { plural } from "@/lib/mantencion/format"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { listHistoricalRecords } from "@/lib/services/mantencion/historical-import"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial anterior de mantención" }
export const dynamic = "force-dynamic"
const PATH = "/mantencion/registros/historicos"
type Params = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""

export default async function HistoricalRecordsPage({ searchParams }: { searchParams: Promise<Params> }) {
  let session
  try { session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"]) }
  catch { redirect("/forbidden") }
  const raw = await searchParams
  const search = first(raw.q).slice(0, 100)
  const vehicleId = first(raw.equipo).slice(0, 64)
  const pendingParam = first(raw.vinculo)
  const pending = pendingParam === "equipment" || pendingParam === "conflict" || pendingParam === "worksite" ? pendingParam : undefined
  const page = Number(first(raw.page))
  const list = await listHistoricalRecords(viewerFromSession(session), { search, vehicleId, page, pending })
  const pagination = resolvePagination({ pageParam: String(list.page), totalItems: list.total, pageSize: list.pageSize })
  const canImport = can(session, "mant:equipment:manage") && can(session, "mant:records:view_all")
  return <PageContainer>
    <PageHeader title="Historial anterior" description="Trabajos registrados en los formularios anteriores, con sus datos de origen." breadcrumb={[{ label: "Mantención", href: "/mantencion/registros" }, { label: "Historial anterior" }]} actions={canImport ? <Button asChild><Link href={`${PATH}/importar`}>Importar historial</Link></Button> : undefined} />
    <form action={PATH} className="mb-4 flex flex-wrap items-end gap-2">
      <Field label="Buscar en el historial" htmlFor="historical-search" className="w-full max-w-sm"><Input id="historical-search" name="q" defaultValue={search} placeholder="Equipo, orden, faena o trabajo" /></Field>
      <Field label="Vínculos" htmlFor="historical-pending" className="w-full max-w-60"><OptionSelect id="historical-pending" name="vinculo" defaultValue={pending ?? ""} emptyLabel="Todos" options={[{ value: "equipment", label: "Equipo pendiente" }, { value: "conflict", label: "Equipo con discrepancia" }, { value: "worksite", label: "Faena pendiente" }]} /></Field>
      {vehicleId && <input type="hidden" name="equipo" value={vehicleId} />}
      <Button type="submit" variant="secondary">Buscar</Button>
      {(search || vehicleId || pending) && <Button asChild variant="ghost"><Link href={PATH}>Ver todo</Link></Button>}
    </form>
    <p className="mb-3 text-sm text-[var(--color-text-muted)]">{plural(list.total, "trabajo", "trabajos")} {vehicleId ? "de este equipo" : "en el historial"}. Estos antecedentes no modifican las lecturas ni los indicadores actuales.</p>
    {list.rows.length === 0 ? <EmptyState title="No hay antecedentes para mostrar" description={search || vehicleId || pending ? "Prueba con otra búsqueda o revisa el historial completo." : "Cuando se importe un consolidado, los trabajos aparecerán aquí."} /> : <>
      <ul aria-label="Trabajos históricos de mantención como tarjetas" className="grid gap-3 md:hidden">{list.rows.map((row) => <li key={row.sourceKey}>
        <ResponsiveDataListCard title={row.equipmentText || "Sin equipo"} description={`${row.worksiteText || "Sin faena"} · ${row.entryDate ? formatDate(row.entryDate) : "Fecha no informada"}`}
          actions={<Button asChild variant="secondary" size="sm" className="w-full"><Link href={`${PATH}/${row.sourceKey}`} aria-label={`Ver antecedente de ${row.equipmentText || "equipo no informado"}, orden ${row.orderText || "sin número"}`}>Ver antecedente</Link></Button>}>
          <ResponsiveDataListField label="Acción">{row.kindText || "No informada"}</ResponsiveDataListField>
          <ResponsiveDataListField label="Orden">{row.orderText || "No informada"}</ResponsiveDataListField>
          <ResponsiveDataListField label="Trabajo" className="col-span-2"><span className="whitespace-pre-wrap break-words">{row.description || "No informado"}</span></ResponsiveDataListField>
          {(!row.vehicleId || !row.worksiteId) && <ResponsiveDataListField label="Pendiente" className="col-span-2"><span className="text-[var(--color-warning-ink)]">{[!row.vehicleId ? "Equipo por vincular" : "", !row.worksiteId ? "Faena por vincular" : ""].filter(Boolean).join(" · ")}</span></ResponsiveDataListField>}
        </ResponsiveDataListCard>
      </li>)}</ul>
      <div className="hidden md:block">
      <TableRoot aria-label="Trabajos históricos de mantención"><Table><TableHeader><TableRow><TableHead>Fecha de ingreso</TableHead><TableHead>Equipo</TableHead><TableHead>Faena</TableHead><TableHead>Acción</TableHead><TableHead>Trabajo</TableHead><TableHead>Orden</TableHead></TableRow></TableHeader>
        <TableBody>{list.rows.map((row) => <TableRow key={row.sourceKey}>
          <TableCell className="whitespace-nowrap">{row.entryDate ? formatDate(row.entryDate) : "No informada"}</TableCell>
          <TableCell><Link href={`${PATH}/${row.sourceKey}`} className="font-semibold text-[var(--color-primary-ink)] hover:underline">{row.equipmentText || "Sin equipo"}</Link>{!row.vehicleId && <span className="block text-xs text-[var(--color-warning-ink)]">Equipo por vincular</span>}</TableCell>
          <TableCell>{row.worksiteText || "No informada"}{!row.worksiteId && <span className="block text-xs text-[var(--color-warning-ink)]">Faena por vincular</span>}</TableCell><TableCell>{row.kindText || "No informada"}</TableCell>
          <TableCell className="max-w-sm"><span className="line-clamp-2">{row.description || "No informado"}</span></TableCell><TableCell>{row.orderText || "—"}</TableCell>
        </TableRow>)}</TableBody></Table></TableRoot>
      </div>
      <ServerPagination pagination={pagination} hrefForPage={(target) => buildPaginationHref(PATH, raw, target)} />
    </>}
  </PageContainer>
}
