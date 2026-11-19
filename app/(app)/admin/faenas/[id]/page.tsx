import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { listMandanteOptions } from "@/lib/services/contracts/contracts"
import { getWorksiteContractView } from "@/lib/services/contracts/worksite-view"
import { todayInChile } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { WorksiteContractsView } from "./worksite-contracts-view"

export const metadata: Metadata = { title: "Faena" }

/**
 * Detalle de una faena: sus contratos, los equipos de cada uno y los que aún no
 * tienen contrato. Contratos y mandantes con `admin:worksites`; asignar equipos
 * con `mant:equipment:manage` (la acción lo vuelve a exigir: ocultar el botón no
 * es autorización).
 */
export default async function FaenaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { redirect("/forbidden") }

  const { id } = await params
  if (!canAccessWorksite(session, id)) notFound()

  const [view, mandantes] = await Promise.all([getWorksiteContractView(id), listMandanteOptions()])
  if (!view) notFound()

  return (
    <PageContainer width="workbench">
      <WorksiteContractsView
        view={view}
        mandantes={mandantes}
        canAssign={can(session, "mant:equipment:manage")}
        today={todayInChile()}
      />
    </PageContainer>
  )
}
