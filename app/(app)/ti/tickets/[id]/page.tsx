import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { and, asc, eq, inArray } from "drizzle-orm"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itTickets, users } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getTicketById, getTicketTimeline } from "@/lib/services/ti/tickets"
import { ticketDueInfo } from "@/lib/services/ti/ticket-sla"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { TicketDetail } from "./ticket-detail"

export const metadata: Metadata = { title: "Ticket de mesa de ayuda" }

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requireAnyPermission(["ti:view", "ti:create_ticket", "ti:manage_tickets"]) }
  catch { redirect("/forbidden") }

  const { id } = await params
  const scope = worksiteScopeSql(session, itTickets.worksiteId)
  const ticket = await getTicketById(id, scope)
  if (!ticket) notFound()

  // Sin `ti:view`, el representante de faena solo abre los tickets que él
  // levantó: es el complemento del listado propio en /ti/tickets.
  if (!can(session, "ti:view") && ticket.requesterUserId !== session.user.id) notFound()

  const canManage = can(session, "ti:manage_tickets")
  const canInternal = can(session, "ti:comment_internal")
  const canComment = canManage || can(session, "ti:create_ticket")

  // Técnicos asignables: quienes pueden gestionar tickets TI. Solo se consulta
  // cuando el panel de gestión va a renderizarse.
  const [timeline, technicians] = await Promise.all([
    getTicketTimeline(id, canInternal),
    canManage ? assignableTechnicians() : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title={ticket.code}
        description={ticket.subject}
        breadcrumb={<Breadcrumbs items={[
          { label: "TI", href: "/ti" },
          { label: "Mesa de ayuda", href: "/ti/tickets" },
          { label: ticket.code },
        ]} />}
      />

      <TicketDetail
        ticket={ticket}
        timeline={timeline}
        // Calculado aquí y no en el cliente: «en 2 días» depende de la hora y
        // distinta entre servidor y navegador rompería la hidratación.
        due={ticketDueInfo(ticket)}
        currentUserId={session.user.id}
        technicians={technicians}
        canManage={canManage}
        canInternal={canInternal}
        canComment={canComment}
      />
    </PageContainer>
  )
}

async function assignableTechnicians(): Promise<{ id: string; name: string }[]> {
  const ids = await getUserIdsWithPermission("ti:manage_tickets")
  if (ids.length === 0) return []
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
