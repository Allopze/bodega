import type { Metadata } from "next"
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
import { listTickets } from "@/lib/services/ti/tickets"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { TicketsTable } from "./tickets-table"
import { TicketSheet } from "./ticket-sheet"
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
  const [rows, workersList, worksitesList, assetOptions] = await Promise.all([
    canView ? listTickets({
      status: typeof sp.estado === "string" ? sp.estado : undefined,
      priority: typeof sp.prioridad === "string" ? sp.prioridad : undefined,
      category: typeof sp.categoria === "string" ? sp.categoria : undefined,
      scope,
    }) : Promise.resolve([]),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    listAssetOptions(assetScope),
  ])

  const ticketsByStatus = new Map<string, number>()
  for (const row of rows) {
    ticketsByStatus.set(row.status, (ticketsByStatus.get(row.status) ?? 0) + 1)
  }

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

      {canView ? (
        <>
      <div className="mb-4 flex flex-wrap gap-2">
        {[["", "Todos"], ["nuevo", "Nuevos"], ["asignado", "Asignados"], ["en_progreso", "En progreso"], ["esperando_usuario", "Esperando usuario"], ["resuelto", "Resueltos"], ["cerrado", "Cerrados"]].map(([value, label]) => (
          <a
            key={value}
            href={value ? `/ti/tickets?estado=${value}` : "/ti/tickets"}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              (sp.estado ?? "") === value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}{value && ticketsByStatus.has(value) ? ` (${ticketsByStatus.get(value)})` : ""}
          </a>
        ))}
      </div>

      <TicketsTable rows={rows} canManage={canManage} />
        </>
      ) : (
        <EmptyState
          title="Reporta un problema a TI"
          description="Crea un ticket para que el equipo de TI central atienda el requerimiento de tu faena."
        />
      )}
    </PageContainer>
  )
}
