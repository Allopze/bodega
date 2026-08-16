import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listWorksiteOrganizations } from "@/lib/services/prevention-cphs-organization"
import { WorksiteOrganizationList } from "./worksite-organization-list"

export const metadata: Metadata = { title: "Estructura preventiva" }

export default async function PrevencionFaenasPage() {
  let session
  try { session = await requirePermission("prevention:cphs:view") }
  catch { redirect("/forbidden") }

  const worksites = await listWorksiteOrganizations({
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })

  return (
    <PageContainer>
      <PageHeader
        title="Estructura preventiva"
        description="Qué órgano exige la dotación de cada faena y cuál está efectivamente constituido: comité sobre 25 trabajadores, delegado entre 10 y 25."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Estructura preventiva" },
        ]} />}
      />
      <WorksiteOrganizationList worksites={worksites} />
    </PageContainer>
  )
}
