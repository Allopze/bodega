import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { requireAnyPermission } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Órdenes de trabajo" }
export const dynamic = "force-dynamic"

// Fase 0: la lista real la arma la línea de jefatura (L3) sobre
// `lib/services/mantencion/work-orders/query.ts`.
export default async function WorkOrdersPage() {
  try {
    await requireAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all"], "/mantencion/ot")
  } catch {
    redirect("/forbidden")
  }
  return (
    <PageContainer>
      <PageHeader
        title="Órdenes de trabajo"
        description="Reparaciones y mantenciones solicitadas al taller, desde la solicitud hasta la recepción en faena."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Órdenes de trabajo" }]}
      />
      <EmptyState title="Todavía no hay órdenes de trabajo" description="Las órdenes que se creen aparecerán aquí." />
    </PageContainer>
  )
}
