import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { CatalogActions } from "./catalog-actions"
import { WorkerPositionCatalog } from "./catalog"
import { requirePermission } from "@/lib/auth/can"
import { listWorkerCapabilities, listWorkerPositions } from "@/lib/services/worker-positions"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Cargos y capacidades" }

export default async function WorkerPositionsPage() {
  try {
    await requirePermission("admin:worker_positions")
  } catch {
    redirect("/forbidden")
  }

  const [positions, capabilities] = await Promise.all([
    listWorkerPositions(),
    listWorkerCapabilities(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Cargos y capacidades"
        description="Normaliza los cargos de la dotación y define qué capacidades heredan sus trabajadores."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Cargos y capacidades" }]} />}
        actions={<CatalogActions capabilities={capabilities} />}
      />
      <WorkerPositionCatalog positions={positions} capabilities={capabilities} />
    </PageContainer>
  )
}
