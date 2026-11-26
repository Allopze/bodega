import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { ConciliationList } from "@/components/mantencion/jefatura/notas-pedido/conciliation-list"
import { PartsNotesFilters } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-filters"
import {
  buildPartsNotesTabs, parsePartsNotesQuery, PARTS_NOTES_PAGE_SIZE, type InboxTab, type RawSearchParams,
} from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
import { PartsNotesTable } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-table"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { StageTabs } from "@/components/ui/stage-tabs"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { allWorksitesLabel } from "@/lib/auth/worksite-label"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { listPendingConciliation } from "@/lib/services/mantencion/parts/conciliation"
import { listPartsNotes } from "@/lib/services/mantencion/parts-notes/query"
import type { PartsNoteTab } from "@/lib/services/mantencion/parts/types"
import { listExecutionWorksiteOptions } from "@/lib/services/mantencion/work-orders/query"

export const metadata: Metadata = { title: "Notas de pedido" }
export const dynamic = "force-dynamic"

const PATHNAME = "/mantencion/notas-pedido"

/** Qué dice una pestaña vacía: qué significa y qué hacer, sin jerga (regla A4). */
function emptyCopy(tab: InboxTab, filtered: boolean): { title: string; description: string } {
  if (filtered) return { title: "Ninguna nota coincide con los filtros", description: "Prueba con otra faena o quita los filtros." }
  switch (tab) {
    case "pendientes": return { title: "No hay notas por resolver", description: "Cuando un mecánico pida repuestos para una orden de trabajo, la nota aparece aquí hasta que resuelvas cada línea." }
    case "en_gestion": return { title: "No hay notas en gestión", description: "Aquí quedan las notas con líneas ya resueltas que siguen abiertas: en compra, o con repuestos por llegar y usar." }
    case "cerradas": return { title: "Aún no hay notas cerradas", description: "Una nota se cierra cuando todas sus líneas quedaron resueltas, o queda anulada con su motivo." }
    case "por_conciliar": return { title: "No hay repuestos por conciliar", description: "Aquí aparecen los repuestos que un mecánico declaró usar sin que hubiera stock al sincronizar su registro." }
  }
}

export default async function PartsNotesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:np:view_worksite", "mant:np:manage"], PATHNAME)
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const canManage = can(session, "mant:np:manage")
  const raw = await searchParams
  const query = parsePartsNotesQuery(raw, canManage)

  if (!query.explicitTab) {
    // Sin pestaña (o con una que no corresponde) se redirige a una URL con `?estado=` para que la activa se vea marcada.
    const target = new URLSearchParams()
    for (const [key, value] of Object.entries(raw)) {
      const text = Array.isArray(value) ? value[0] : value
      if (text) target.set(key, text)
    }
    target.set("estado", query.tab)
    redirect(`${PATHNAME}?${target.toString()}`)
  }

  // Las faenas que se ofrecen son las del alcance de quien mira; una faena de la URL fuera de él se ignora.
  const allWorksites = await listExecutionWorksiteOptions()
  const worksites = viewer.isGlobal ? allWorksites : allWorksites.filter((item) => viewer.worksiteIds.includes(item.id))
  const worksiteId = query.worksiteId && worksites.some((item) => item.id === query.worksiteId) ? query.worksiteId : undefined

  const onConciliation = query.tab === "por_conciliar"
  const noteTab: PartsNoteTab = onConciliation ? "pendientes" : query.tab
  // Fuera de «Por conciliar» las notas pagan los conteos de las pestañas y, dentro, sólo los conteos (una fila basta).
  const [list, conciliation] = await Promise.all([
    listPartsNotes(viewer, { tab: noteTab, worksiteId, q: query.q, page: onConciliation ? 1 : query.page, pageSize: onConciliation ? 1 : PARTS_NOTES_PAGE_SIZE }),
    canManage
      ? listPendingConciliation(viewer, { worksiteId, page: onConciliation ? query.page : 1, pageSize: onConciliation ? PARTS_NOTES_PAGE_SIZE : 1 })
      : Promise.resolve(null),
  ])

  const total = onConciliation ? (conciliation?.total ?? 0) : list.total
  const pagination = resolvePagination({ pageParam: String(query.page), totalItems: total, pageSize: PARTS_NOTES_PAGE_SIZE })
  const empty = emptyCopy(query.tab, !!(worksiteId || query.q))
  const filtered = !!(worksiteId || query.q)
  const clearFiltersHref = `${PATHNAME}?estado=${query.tab}`
  const rowsEmpty = onConciliation ? (conciliation?.rows.length ?? 0) === 0 : list.rows.length === 0

  return (
    <PageContainer>
      <PageHeader
        title="Notas de pedido"
        description="Repuestos que piden los mecánicos para sus órdenes de trabajo."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Notas de pedido" }]}
      />

      <div className="mb-3">
        <Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
          <StageTabs tabs={buildPartsNotesTabs(list.counts, canManage ? (conciliation?.total ?? 0) : null)} ariaLabel="Estado de las notas de pedido" pageParam="pagina" />
        </Suspense>
      </div>

      <PartsNotesFilters worksites={worksites} allWorksitesLabel={allWorksitesLabel(viewer.isGlobal)} />

      {rowsEmpty ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={clearFiltersHref}>Quitar los filtros</Link></Button>
            : query.tab === "pendientes"
              ? <Button asChild variant="secondary"><Link href="/mantencion/ot">Ver órdenes de trabajo</Link></Button>
              : <Button asChild variant="secondary"><Link href={`${PATHNAME}?estado=pendientes`}>Ver las pendientes</Link></Button>}
        />
      ) : (
        <>
          {onConciliation ? <ConciliationList rows={conciliation?.rows ?? []} /> : <PartsNotesTable rows={list.rows} />}
          <ServerPagination pagination={pagination} hrefForPage={(page) => buildPaginationHref(PATHNAME, raw, page, "pagina")} />
        </>
      )}
    </PageContainer>
  )
}
