import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, canAny, requireAnyPermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itTickets, itAssets, workers, worksites } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { listTickets, countTickets, countTicketsByStatus } from "@/lib/services/ti/tickets"
import { parseTicketOrder } from "@/lib/services/ti/ticket-sla"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { TicketsTable } from "./tickets-table"
import { TicketCta } from "./ticket-sheet"
import { TicketFilters } from "./ticket-filters"
import { TicketStatusPills } from "./status-pills"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"

export const metadata: Metadata = { title: "Mesa de ayuda" }

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAnyPermission(["ti:view", "ti:create_ticket", "ti:manage_tickets"]) }
  catch { redirect("/forbidden") }

  const canView = can(session, "ti:view")
  const canManage = can(session, "ti:manage_tickets")
  const canCreate = canAny(session, "ti:create_ticket", "ti:manage_tickets")
  const sp = await searchParams

  const faena = single(sp.faena)
  // `?faena=` se intersecta con el alcance del usuario (nunca lo amplía): una
  // faena ajena queda como «ninguna fila», no como «todas».
  const scope = worksiteScopeSql(session, itTickets.worksiteId, faena || undefined)
  const assetScope = worksiteScopeSql(session, itAssets.worksiteId)
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  // Quien solo tiene `ti:create_ticket` (representante de faena) ve
  // exclusivamente los tickets que él mismo levantó: antes creaba el ticket y
  // no volvía a verlo nunca, ni su avance ni su resolución.
  const ownTicketsOnly = !canView
  const assigned = single(sp.asignado)
  const dueParam = single(sp.vencimiento)
  const search = single(sp.q).trim().slice(0, 100)
  const baseFilters = {
    priority: single(sp.prioridad) || undefined,
    category: single(sp.categoria) || undefined,
    assigneeUserId: assigned === "yo" ? session.user.id : undefined,
    unassigned: assigned === "sin_asignar" ? true : undefined,
    due: dueParam === "vencido" || dueParam === "por_vencer" ? dueParam : undefined,
    search: search || undefined,
    requesterUserId: ownTicketsOnly ? session.user.id : undefined,
    scope,
  } as const
  const status = single(sp.estado) || undefined
  const order = parseTicketOrder(sp.orden)
  const hasFilters = Boolean(
    status || search || faena || assigned || dueParam || sp.prioridad || sp.categoria,
  )

  const total = await countTickets({ ...baseFilters, status })
  const pagination = resolvePagination({ pageParam: sp.pagina, totalItems: total, pageSize: DEFAULT_PAGE_SIZE })

  const [rows, statusCounts, workersList, worksitesList, assetOptions] = await Promise.all([
    listTickets({ ...baseFilters, status }, { limit: pagination.limit, offset: pagination.offset }, order),
    countTicketsByStatus(baseFilters),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName, worksiteId: workers.worksiteId })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    listAssetOptions(assetScope),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Mesa de ayuda"
        description="Reporta y sigue problemas de equipos, correo, cuentas, accesos y más."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Mesa de ayuda" }]} />}
        actions={canCreate ? (
          <TicketCta workers={workersList} worksites={worksitesList} assets={assetOptions} />
        ) : undefined}
      />

      {ownTicketsOnly && (
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Estás viendo los tickets que levantaste tú. El equipo de TI central atiende el resto.
        </p>
      )}

      <TicketFilters worksites={worksitesList} canManage={canManage} />
      <TicketStatusPills current={status ?? ""} counts={statusCounts} query={sp} />

      {/* Uno u otro, no los dos: `DataTable` ya pinta su propio "Sin
          resultados", así que renderizar ambos apilaba dos estados vacíos. Se
          conserva el de acá, que distingue "no hay nada todavía" de "los
          filtros no calzan", y ofrece la acción para dejar de estar vacío. */}
      {rows.length > 0 ? (
        <>
          <TicketsTable rows={rows} canManage={canManage} />
          <ServerPagination
            pagination={pagination}
            hrefForPage={(page) => buildPaginationHref("/ti/tickets", sp, page, "pagina")}
          />
        </>
      ) : hasFilters ? (
        <EmptyState
          className="mt-4"
          compact
          title="Ningún ticket coincide con estos filtros"
          description="Prueba con otros términos o quita algún filtro para ver más tickets."
          action={
            <Link href="/ti/tickets" scroll={false}>
              <Button variant="secondary" size="sm">Limpiar filtros</Button>
            </Link>
          }
        />
      ) : (
        <EmptyState
          className="mt-4"
          compact
          title={ownTicketsOnly ? "Todavía no has reportado ningún problema" : "No hay tickets abiertos ni cerrados"}
          description={
            ownTicketsOnly
              ? "Crea un ticket para que el equipo de TI central atienda el requerimiento de tu faena."
              : "Cuando alguien reporte un problema de equipos, cuentas o accesos, aparecerá aquí."
          }
          action={canCreate ? (
            <TicketCta workers={workersList} worksites={worksitesList} assets={assetOptions} />
          ) : undefined}
        />
      )}
    </PageContainer>
  )
}
