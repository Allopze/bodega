import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listIncidentWorksites } from "@/lib/services/prevention-incidents"
import { getSftiIncidentImportBatch, listSftiIncidentImportBatches } from "@/lib/services/prevention-incident-import"
import { SftiImportWorkbench } from "./sfti-import-workbench"

export const metadata: Metadata = { title: "Importar incidentes SFTI" }

export default async function SftiIncidentImportPage() {
  let session
  try { session = await requirePermission("prevention:incidents:triage") }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:incidents:view_sensitive")) redirect("/forbidden")
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const [batchRows, worksites] = await Promise.all([
    listSftiIncidentImportBatches(access),
    listIncidentWorksites(access, "prevention:incidents:triage"),
  ])
  const bundles = (await Promise.all(batchRows.map((batch) => getSftiIncidentImportBatch(batch.id, access))))
    .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle))

  return (
    <PageContainer width="full">
      <PageHeader
        title="Importar incidentes desde SFTI"
        description="Carga cifrada, staging, conciliación y aprobación antes de activar historia en la fuente canónica."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes", href: "/prevencion/incidentes" }, { label: "Importar SFTI" }]} />}
      />
      <SftiImportWorkbench batches={bundles} worksites={worksites} canApprove={can(session, "prevention:incidents:close")} />
    </PageContainer>
  )
}
