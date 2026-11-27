import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { ConciliationList } from "@/components/mantencion/jefatura/notas-pedido/conciliation-list"
import { PartsNotesAgeChart } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-age-chart"
import { PartsNotesFilters } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-filters"
import { PartsNotesExportButton } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-export-button"
import {
  buildPartsNotesTabs, defaultInboxTab, exportParamsOf, hasPartsNoteFilters, inboxHref, INBOX_TAB_LABELS, OPEN_NOTE_TABS, parsePartsNoteFilters, parsePartsNotesQuery, PARTS_NOTES_PAGE_SIZE, PARTS_NOTES_VIEW_PERMISSIONS, type InboxTab, type RawSearchParams,
} from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
import { PartsNotesTable } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-table"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
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
  if (filtered) return { title: "Ninguna nota coincide con los filtros", description: "Prueba con otros filtros o quítalos para ver todas las notas." }
  switch (tab) {
    case "por_revisar": return { title: "No hay notas por revisar", description: "Cuando alguien pida repuestos, para una orden de trabajo o para la faena, la nota aparece aquí mientras le quede una línea por resolver." }
    case "en_compra": return { title: "No hay notas esperando su orden de compra", description: "Aquí quedan las notas cuyos repuestos ya se enviaron a compra y todavía no tienen una orden de compra emitida." }
    case "en_recepcion": return { title: "No hay notas esperando su recepción", description: "Aquí quedan las notas con orden de compra emitida, o recibidas en parte, mientras falte que el repuesto llegue a la faena." }
    case "cerradas": return { title: "Aún no hay notas cerradas", description: "Una nota se cierra cuando todo lo pedido llegó a la faena o se sacó de la bodega; también quedan aquí las rechazadas y las anuladas, con su motivo." }
    case "por_conciliar": return { title: "No hay repuestos por conciliar", description: "Aquí aparecen los repuestos que un mecánico declaró usar sin que hubiera stock al sincronizar su registro." }
  }
}

export default async function PartsNotesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    // Ver las de sus faenas, resolverlas, comprarlas o ver las propias (`view_own`): `listPartsNotes` aplica el alcance de cada una.
    session = await requireAnyPermission(PARTS_NOTES_VIEW_PERMISSIONS, PATHNAME)
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const canManage = can(session, "mant:np:manage")
  const canCreate = can(session, "mant:np:create")
  const canExport = can(session, "mant:np:export")
  const raw = await searchParams
  // Sin pestaña en la URL abre donde está el trabajo de quien mira: revisar (administra o ve las suyas) o la compra (sólo compra).
  const defaultTab = defaultInboxTab({ canManage, canPurchase: can(session, "mant:np:purchase") })
  const query = parsePartsNotesQuery(raw, canManage, defaultTab)

  if (!query.explicitTab) {
    // Sin pestaña (o con una que no corresponde, o una de antes: `pendientes`, `en_gestion`) se redirige a una URL con `?estado=`
    // para que la activa se vea marcada.
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
  // Los filtros que viajan al servicio: los de la URL ya validados, con la faena acotada al alcance. «Por conciliar» sólo filtra por faena.
  const filters = { ...parsePartsNoteFilters(raw), worksiteId }

  const onConciliation = query.tab === "por_conciliar"
  const noteTab: PartsNoteTab = query.tab === "por_conciliar" ? defaultTab : query.tab
  // Fuera de «Por conciliar» las notas pagan los conteos de las pestañas y, dentro, sólo los conteos (una fila basta).
  const [list, conciliation] = await Promise.all([
    listPartsNotes(viewer, { ...(onConciliation ? { worksiteId } : filters), tab: noteTab, page: onConciliation ? 1 : query.page, pageSize: onConciliation ? 1 : PARTS_NOTES_PAGE_SIZE }),
    canManage
      ? listPendingConciliation(viewer, { worksiteId, page: onConciliation ? query.page : 1, pageSize: onConciliation ? PARTS_NOTES_PAGE_SIZE : 1 })
      : Promise.resolve(null),
  ])

  const total = onConciliation ? (conciliation?.total ?? 0) : list.total
  const pagination = resolvePagination({ pageParam: String(query.page), totalItems: total, pageSize: PARTS_NOTES_PAGE_SIZE })
  const filtered = onConciliation ? !!worksiteId : hasPartsNoteFilters(filters)
  const empty = emptyCopy(query.tab, filtered)
  const clearFiltersHref = `${PATHNAME}?estado=${query.tab}`
  const rowsEmpty = onConciliation ? (conciliation?.rows.length ?? 0) === 0 : list.rows.length === 0

  // «N urgentes»: las notas urgentes y abiertas del alcance. Activo, el enlace es la salida (contrato de `HeaderSignals`); si no,
  // lleva a la pestaña actual o, si ahí no hay ninguna, a la primera donde sí (así el clic nunca cae en una lista vacía).
  const urgentActive = filters.urgent === true
  const urgentTab = list.urgentByTab[noteTab] > 0 ? noteTab : OPEN_NOTE_TABS.find((tab) => list.urgentByTab[tab] > 0) ?? noteTab
  const headerSignals: HeaderSignal[] = [{
    key: "urgent",
    label: list.urgentOpen === 1 ? "urgente" : "urgentes",
    value: list.urgentOpen,
    tone: "signal",
    active: urgentActive,
    href: urgentActive
      ? inboxHref(PATHNAME, raw, { urgencia: null, urgente: null })
      : inboxHref(PATHNAME, raw, urgentTab === query.tab
        ? { urgencia: "urgente", urgente: null }
        // Otra pestaña: el estado exacto y el tramo de antigüedad de esta ya no significan lo mismo allá.
        : { estado: urgentTab, urgencia: "urgente", urgente: null, situacion: null, antiguedad: null }),
  }]

  return (
    <PageContainer>
      <PageHeader
        title="Notas de pedido"
        description="Repuestos que se piden para las órdenes de trabajo y para las faenas."
        headerActions={onConciliation ? undefined : <HeaderSignals signals={headerSignals} allClearLabel="Sin urgentes" />}
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Notas de pedido" }]}
        actions={(canExport && !onConciliation) || canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            {canExport && !onConciliation && <PartsNotesExportButton params={exportParamsOf(raw, query.tab)} tabLabel={INBOX_TAB_LABELS[query.tab]} />}
            {canCreate && <Button asChild size="sm"><Link href="/mantencion/notas-pedido/nueva">Nueva nota</Link></Button>}
          </div>
        ) : undefined}
      />

      <div className="mb-3">
        <Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
          <StageTabs tabs={buildPartsNotesTabs(list.counts, canManage ? (conciliation?.total ?? 0) : null, defaultTab)} ariaLabel="Estado de las notas de pedido" pageParam="pagina" />
        </Suspense>
      </div>

      <PartsNotesFilters worksites={worksites} allWorksitesLabel={allWorksitesLabel(viewer.isGlobal)} tab={query.tab} />

      {/* La antigüedad sólo tiene sentido donde la nota espera algo: en las tres pestañas abiertas. */}
      {!onConciliation && query.tab !== "cerradas" && <PartsNotesAgeChart counts={list.ageCounts} active={filters.age} path={PATHNAME} raw={raw} />}

      {rowsEmpty ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={clearFiltersHref}>Quitar los filtros</Link></Button>
            : query.tab === "por_revisar"
              ? <Button asChild variant="secondary"><Link href="/mantencion/ot">Ver órdenes de trabajo</Link></Button>
              : <Button asChild variant="secondary"><Link href={`${PATHNAME}?estado=por_revisar`}>Ver las notas por revisar</Link></Button>}
        />
      ) : (
        <>
          {onConciliation ? <ConciliationList rows={conciliation?.rows ?? []} /> : <PartsNotesTable rows={list.rows} selectable={canManage && query.tab === "por_revisar"} />}
          <ServerPagination pagination={pagination} hrefForPage={(page) => buildPaginationHref(PATHNAME, raw, page, "pagina")} />
        </>
      )}
    </PageContainer>
  )
}
