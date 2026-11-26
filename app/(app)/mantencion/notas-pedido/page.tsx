import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { requireAnyPermission } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Notas de pedido" }
export const dynamic = "force-dynamic"

/**
 * Bandeja de las notas de pedido de repuestos del mecánico (ADR mantención 0001).
 * Esqueleto de la Fase 0: la línea L6 la reemplaza con la bandeja y el detalle.
 */
export default async function PartsNotesPage() {
  try {
    await requireAnyPermission(["mant:np:view_worksite", "mant:np:manage"], "/mantencion/notas-pedido")
  } catch {
    redirect("/forbidden")
  }
  return (
    <PageContainer>
      <PageHeader
        title="Notas de pedido"
        description="Repuestos que piden los mecánicos para sus órdenes de trabajo."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Notas de pedido" }]}
      />
      <EmptyState title="Sin notas de pedido" description="Cuando un mecánico pida repuestos para una orden de trabajo, aparecerán aquí." />
    </PageContainer>
  )
}
