import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { itTickets } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getTicketById, getTicketComments } from "@/lib/services/ti/tickets"
import { TicketDetail } from "./ticket-detail"

export const metadata: Metadata = { title: "Ticket TI" }

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const scope = worksiteScopeSql(session, itTickets.worksiteId)
  const ticket = await getTicketById(id, scope)
  if (!ticket) notFound()

  const canManage = can(session, "ti:manage_tickets")
  const canInternal = can(session, "ti:comment_internal")
  const canComment = canManage || can(session, "ti:create_ticket")

  const comments = await getTicketComments(id, canInternal)

  return (
    <PageContainer>
      <PageHeader
        title={ticket.code}
        description={ticket.subject}
        breadcrumb={<Breadcrumbs items={[
          { label: "TI", href: "/ti" },
          { label: "Tickets", href: "/ti/tickets" },
          { label: ticket.code },
        ]} />}
      />

      <TicketDetail
        ticket={ticket}
        comments={comments}
        canManage={canManage}
        canInternal={canInternal}
        canComment={canComment}
      />
    </PageContainer>
  )
}
