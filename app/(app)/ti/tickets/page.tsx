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
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { listTickets, countTicketsByStatus } from "@/lib/services/ti/tickets"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { TicketsTable } from "./tickets-table"
import { TicketSheet } from "./ticket-sheet"
import { TicketFilters } from "./ticket-filters"
import { TicketStatusPills } from "./status-pills"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata: Metadata = { title: "Tickets TI" }

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

  const scope = worksiteScopeSql(session, itTickets.worksiteId)
  const assetScope = worksiteScopeSql(session, itAssets.worksiteId)
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  // Quien solo tiene `ti:create_ticket` (representante de faena) ve
  // exclusivamente los tickets que él mismo levantó: antes creaba el ticket y
  // no volvía a verlo nunca, ni su avance ni su resolución.
  const ownTicketsOnly = !canView
  const baseFilters = {
    priority: typeof sp.prioridad === "string" ? sp.prioridad : undefined,
    category: typeof sp.categoria === "string" ? sp.categoria : undefined,
    requesterUserId: ownTicketsOnly ? session.user.id : undefined,
    scope,
  }
  const status = typeof sp.estado === "string" ? sp.estado : undefined

  const [rows, statusCounts, workersList, worksitesList, assetOptions] = await Promise.all([
    listTickets({ ...baseFilters, status }),
    countTicketsByStatus(baseFilters),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    listAssetOptions(assetScope),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Tickets TI"
        description="Mesa de ayuda: hardware, software, correo, internet, impresoras, accesos y más."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Tickets" }]} />}
        actions={canCreate ? (
          <TicketSheet
            trigger={<Button><Plus size={14} className="mr-1.5" /> Nuevo ticket</Button>}
            workers={workersList}
            worksites={worksitesList}
            assets={assetOptions}
          />
        ) : undefined}
      />

      {ownTicketsOnly && (
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Estás viendo los tickets que levantaste tú. El equipo de TI central atiende el resto.
        </p>
      )}

      <TicketFilters current={sp} />
      <TicketStatusPills current={status ?? ""} counts={statusCounts} query={sp} />

      {/* Uno u otro, no los dos: `DataTable` ya pinta su propio "Sin
          resultados", así que renderizar ambos apilaba dos estados vacíos. Se
          conserva el de acá, que sí distingue "no reportaste nada" de "los
          filtros no calzan". */}
      {rows.length > 0 ? (
        <TicketsTable rows={rows} canManage={canManage} />
      ) : (
        <EmptyState
          className="mt-4"
          compact
          title={ownTicketsOnly ? "Todavía no has reportado ningún problema" : "No hay tickets con estos filtros"}
          description={
            ownTicketsOnly
              ? "Crea un ticket para que el equipo de TI central atienda el requerimiento de tu faena."
              : "Prueba con otros filtros o términos de búsqueda."
          }
          action={
            <Link href="/ti/tickets">
              <Button variant="secondary" size="sm">Limpiar filtros</Button>
            </Link>
          }
        />
      )}
    </PageContainer>
  )
}
