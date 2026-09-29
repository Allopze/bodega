import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getWorksiteOrganization } from "@/lib/services/prevention-cphs-organization"
import { listCommitteeWorkers } from "@/lib/services/prevention-cphs"
import { WorksiteProfile } from "./worksite-profile"
import { nullIfCphsNotFound } from "@/lib/services/prevention-cphs-access"

export const metadata: Metadata = { title: "Ficha preventiva de faena" }

export default async function FichaPreventivaPage({ params }: { params: Promise<{ worksiteId: string }> }) {
  const { worksiteId } = await params

  let session
  try { session = await requirePermission("prevention:cphs:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/faenas")}`) }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }

  // M-10 (auditoría 2026-09-28): sólo "no existe o fuera de alcance" es un 404.
  // Cualquier otro error (base caída, consulta rota) se relanza para que llegue
  // a la página de error y al log, en vez de fingir que la faena no existe.
  const profile = await getWorksiteOrganization(worksiteId, access).catch(nullIfCphsNotFound)
  if (!profile) notFound()

  const canManage = session.user.permissions.includes("prevention:cphs:manage")
  const allWorkers = canManage ? await listCommitteeWorkers(access) : []
  const eligibleWorkers = allWorkers
    .filter((worker) => worker.worksiteId === worksiteId)
    .map((worker) => ({
      id: worker.id,
      name: `${worker.lastName}, ${worker.firstName}`,
      position: worker.position,
    }))

  return (
    <PageContainer>
      <PageHeader
        title={profile.worksiteName}
        description="Ficha preventiva: dotación, órgano exigible y registros de constitución."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Estructura preventiva", href: "/prevencion/faenas" },
          { label: profile.worksiteName },
        ]} />}
      />
      <WorksiteProfile profile={profile} eligibleWorkers={eligibleWorkers} canManage={canManage} />
    </PageContainer>
  )
}
