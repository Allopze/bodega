import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites, users } from "@/db/schema"
import { desc, count, inArray, eq, and, sql } from "drizzle-orm"
import { requireAuth, can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { eqFilter, parseListParams, periodSql, statusSql } from "@/lib/adquisiciones/list-query"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { solicitudesSearchSql } from "@/lib/adquisiciones/solicitudes-filter"
import type { StageTab } from "@/components/ui/stage-tabs"
import { buildUrgencySignal, CRITICAL_URGENCY } from "./urgency-signal"
import { RequestList } from "./request-list"
import { SolicitudesActions } from "./solicitudes-actions"

export const metadata: Metadata = { title: "Solicitudes de compra" }

import { SOLICITUDES_PAGE_SIZE } from "@/lib/constants"

/**
 * Etapas visibles de una solicitud (A5: el estado se representa una sola vez).
 * "Borrador" sólo lo alcanzan repuestos y servicios, que adjuntan cotizaciones
 * antes de enviar; EPP y otros nacen en aprobación.
 */
const STAGE_GROUPS = [
  { value: "draft",                                          label: "Borrador" },
  { value: "submitted,in_review",                            label: "En aprobación" },
  { value: "approved,partially_approved,in_purchasing",      label: "En curso" },
  { value: "closed,rejected,cancelled",                      label: "Cerradas" },
] as const

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "requests:view_own") && !can(session, "requests:view_all")) {
    redirect("/forbidden")
  }

  const sp = await searchParams
  const viewAll = can(session, "requests:view_all")

  /*
   * REQ-001 (auditoría 2026-09-14): `view_all` quitaba también la faena. Son
   * dos ejes distintos y el contrato de `lib/auth/scope.ts` los separa:
   * `view_all` amplía dentro del módulo —de "mis solicitudes" a "todas"— y
   * `isGlobal` es lo único que autoriza a cruzar faenas. Un rol no global con
   * `requests:view_all` leía las solicitudes de cualquier faena.
   *
   * Aquí queda sólo el eje de propiedad; el de faena lo aplica
   * `worksiteScopeSql` más abajo, que intersecta el alcance del rol con la
   * faena elegida en la URL en vez de dejar que la reemplace. Es el mismo
   * predicado que ya usaba el exportador de solicitudes.
   */
  const filterConditions = viewAll
    ? undefined
    : eq(purchaseRequests.requesterId, session.user.id)

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)

  // Extended text search: match the request code OR any item's product name
  // (free-text or catalogue). Uses EXISTS to avoid row duplication without JOIN.
  // REQ-003: el mismo predicado que usa el exportador, no una copia. Cuando
  // vivían separados, la búsqueda por nombre de producto existía sólo aquí.
  const textCondition = solicitudesSearchSql(listParams.q)

  /*
   * REQ-004 (auditoría 2026-09-14): tres recortes, no dos, porque la señal de
   * urgencia necesita contar sobre el contexto pero SIN contarse a sí misma.
   *
   * `contextWhere` = propiedad + búsqueda + faena + período. Es "lo que estoy
   * mirando", sin estado ni urgencia.
   */
  const contextWhere = and(
    filterConditions,
    textCondition,
    worksiteScopeSql(session, purchaseRequests.worksiteId, listParams.faena),
    periodSql(purchaseRequests.createdAt, listParams.desde, listParams.hasta),
  )

  /*
   * REQ-004: `urgencia` se parseaba desde la URL pero NUNCA entraba al
   * predicado, así que pulsar "Urgencia crítica" dejaba `?urgencia=critical` en
   * la barra de direcciones y devolvía la misma lista sin filtrar. Va en
   * `scopeWhere` —no en `where`— para que las pestañas de etapa cuenten el
   * mismo subconjunto que la lista entrega al pulsarlas.
   *
   * El estado se aplica aparte para poder contar las tabs sobre el mismo
   * recorte sin él: cada tab anuncia lo que entregaría al pulsarla.
   */
  const scopeWhere = and(contextWhere, eqFilter(purchaseRequests.urgency, listParams.urgencia))
  const where = and(scopeWhere, statusSql(purchaseRequests.status, listParams.estados))

  // La urgencia crítica es la única señal del header: el estado ya se representa
  // una sola vez, en las tabs de etapa (regla A5). El chip "Borradores"
  // desapareció con ellos — EPP/otro nacen enviadas y sólo los tipos con
  // cotización conservan borrador, visible en su propia tab.
  const [totalRow, metricsRow, stageCountRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(purchaseRequests)
      .where(where)
      .then((res) => res[0]),

    /*
     * REQ-004: este conteo usaba sólo `filterConditions` —el eje de propiedad—
     * e ignoraba faena, período y búsqueda. La cifra del encabezado hablaba
     * entonces de una población distinta de la que había en pantalla. Ahora
     * cuenta sobre `contextWhere`: el mismo recorte que la lista, menos el
     * filtro de urgencia (contarse a sí misma dejaría la señal congelada en su
     * propio total al pulsarla) y menos el de etapa, porque la señal es del
     * encabezado y no de una pestaña.
     */
    db
      .select({
        critical: count(sql`CASE WHEN ${purchaseRequests.urgency} = ${CRITICAL_URGENCY} THEN 1 END`),
      })
      .from(purchaseRequests)
      .where(contextWhere)
      .then((res) => res[0]),

    db
      .select({ status: purchaseRequests.status, total: count() })
      .from(purchaseRequests)
      .where(scopeWhere)
      .groupBy(purchaseRequests.status),
  ])

  const countByStatus = Object.fromEntries(stageCountRows.map((row) => [row.status, row.total]))
  const stageTabs: StageTab[] = [
    { value: "", label: "Todas", count: stageCountRows.reduce((sum, row) => sum + row.total, 0) },
    ...STAGE_GROUPS.map((group) => ({
      value: group.value,
      label: group.label,
      count: group.value.split(",").reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0),
    })),
  ]

  // REQ-004: el href era fijo y descartaba el contexto activo; ahora lo
  // conserva, y cuando el filtro ya está puesto el chip se marca activo y su
  // enlace pasa a ser la salida (contrato `active` de `HeaderSignals`).
  const urgencySignal = buildUrgencySignal(sp)
  const headerSignals: HeaderSignal[] = [
    {
      key: "critical",
      label: "Urgencia crítica",
      value: metricsRow?.critical ?? 0,
      href: urgencySignal.href,
      active: urgencySignal.active,
      tone: "signal",
    },
  ]

  const exportParams = new URLSearchParams({ tipo: "solicitudes" })
  if (listParams.q) exportParams.set("q", listParams.q)
  // `estados` es un arreglo: siempre truthy, así que el href llevaba `status=`
  // vacío incluso sin filtro de estado.
  if (listParams.estados.length > 0) exportParams.set("status", listParams.estados.join(","))
  if (listParams.faena) exportParams.set("faena", listParams.faena)
  // REQ-003: el período se perdía en el camino a Excel, así que el archivo
  // traía todo el histórico aunque la pantalla mostrara un mes.
  if (listParams.desde) exportParams.set("from", listParams.desde)
  if (listParams.hasta) exportParams.set("to", listParams.hasta)
  const exportHref = `/api/reportes/export?${exportParams.toString()}`

  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRow?.total ?? 0,
    pageSize: SOLICITUDES_PAGE_SIZE,
  })

  // Load paginated requests and active worksites in parallel
  const [pageRequests, activeWorksites] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        urgency:      purchaseRequests.urgency,
        requestType:  purchaseRequests.requestType,
        status:       purchaseRequests.status,
        submittedAt:  purchaseRequests.submittedAt,
        createdAt:    purchaseRequests.createdAt,
        requesterId:  purchaseRequests.requesterId,
      })
      .from(purchaseRequests)
      .where(where)
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),

    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
  ])

  // Filter worksites scoped to the user
  const scopedWorksites = activeWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )
  const hasWorksites = scopedWorksites.length > 0
  const worksiteOptions = scopedWorksites.map((w) => ({ value: w.id, label: w.name }))

  const pageHref = (page: number) => buildPaginationHref("/solicitudes", sp, page)

  if (pageRequests.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          newShortcutHref="/solicitudes/nueva"
          title="Solicitudes de compra"
          description="Historial de solicitudes de compra por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Solicitudes" },
            ]} />
          }
          headerActions={<HeaderSignals signals={headerSignals} />}
          actions={<SolicitudesActions canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} exportHref={exportHref} />}
        />
        <RequestList requests={[]} currentUserId={session.user.id} canDeleteAny={can(session, "requests:delete")} worksiteOptions={worksiteOptions} stageTabs={stageTabs} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const requestIds = pageRequests.map((r) => r.id)
  const wsIds      = [...new Set(pageRequests.map((r) => r.worksiteId))]
  const requesterIds = [...new Set(pageRequests.map((r) => r.requesterId))]

  // Batch load related data — only for the current page
  const [wsRows, requesterRows, itemCounts] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, requesterIds)),

    db.select({ requestId: purchaseRequestItems.requestId, total: count() })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.requestId, requestIds))
      .groupBy(purchaseRequestItems.requestId),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const userMap = Object.fromEntries(requesterRows.map((u) => [u.id, u.name ?? u.email ?? u.id]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  const rows = pageRequests.map((r) => ({
    id:             r.id,
    code:           r.code,
    requestType:    r.requestType,
    worksiteName:   wsMap[r.worksiteId] ?? r.worksiteId,
    urgency:        r.urgency,
    status:         r.status,
    itemCount:      cntMap[r.id] ?? 0,
    submittedAt:    r.submittedAt,
    createdAt:      r.createdAt,
    requesterId:    r.requesterId,
    requesterName:  userMap[r.requesterId] ?? r.requesterId,
  }))

  const canDeleteAny = can(session, "requests:delete")

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de compra"
        description="Historial de solicitudes de compra por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Solicitudes" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<SolicitudesActions canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} exportHref={exportHref} />}
      />
      <RequestList
        requests={rows}
        currentUserId={session.user.id}
        canDeleteAny={canDeleteAny}
        worksiteOptions={worksiteOptions}
        stageTabs={stageTabs}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
