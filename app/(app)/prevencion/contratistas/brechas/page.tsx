import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listAccreditationGaps } from "@/lib/services/prevention-contractors"
import { AccreditationGapList } from "./accreditation-gap-list"

export const metadata: Metadata = { title: "Brechas de acreditación" }

export default async function BrechasAcreditacionPage() {
  let session
  try { session = await requirePermission("prevention:contractors:view") }
  catch { redirect("/forbidden") }

  const gaps = await listAccreditationGaps({
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })

  return (
    <PageContainer>
      <PageHeader
        title="Brechas de acreditación"
        description="Evidencia exigida por el DS 76 que hoy no está aprobada y vigente. Una brecha bloqueante impide el ingreso a faena."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Contratistas", href: "/prevencion/contratistas" },
          { label: "Brechas" },
        ]} />}
      />
      <AccreditationGapList gaps={gaps} />
    </PageContainer>
  )
}
