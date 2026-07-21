import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPreventionPrivacyRequests } from "@/lib/services/prevention-privacy"
import { PrivacyRequestCreateButton } from "./privacy-request-create-button"
import { PrivacyRequestsWorkbench } from "./privacy-requests-workbench"

export const metadata: Metadata = { title: "Solicitudes de privacidad" }

export default async function PreventionPrivacyRequestsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:privacy:manage_requests")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const scopeWhere = scope.mode === "some" ? inArray(workers.worksiteId, scope.ids) : undefined
  const [requests, workerRows] = await Promise.all([
    listPreventionPrivacyRequests(scope),
    scope.mode === "none"
      ? []
      : db.select({
          id: workers.id,
          firstName: workers.firstName,
          lastName: workers.lastName,
          rut: workers.rut,
          worksiteName: worksites.name,
        }).from(workers)
          .innerJoin(worksites, eq(worksites.id, workers.worksiteId))
          .where(scopeWhere)
          .orderBy(workers.lastName, workers.firstName),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de privacidad"
        description="Gestiona derechos del titular, validación de identidad, retenciones y entregas auditadas."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Privacidad", href: "/prevencion/privacidad/auditoria" },
          { label: "Solicitudes" },
        ]} />}
        actions={<PrivacyRequestCreateButton workers={workerRows.map((worker) => ({
          id: worker.id,
          label: `${worker.lastName}, ${worker.firstName}${worker.rut ? ` · ${worker.rut}` : ""} · ${worker.worksiteName}`,
        }))} />}
      />
      <PrivacyRequestsWorkbench
        rows={requests.map((row) => ({
          id: row.request.id,
          subjectWorkerId: row.request.subjectWorkerId,
          subjectName: `${row.workerName} ${row.workerLastName}`,
          subjectRut: row.workerRut,
          worksiteName: row.worksiteName,
          rightType: row.request.rightType,
          status: row.request.status,
          requestScope: row.request.requestScope,
          receivedAt: row.request.receivedAt,
          dueAt: row.request.dueAt,
          legalHold: row.request.legalHold,
          legalHoldReason: row.request.legalHoldReason,
          identityVerifiedAt: row.request.identityVerifiedAt,
        }))}
        canExport={can(session, "prevention:privacy:export_subject")}
        canExportClinical={can(session, "prevention:health:view_clinical")}
      />
    </PageContainer>
  )
}