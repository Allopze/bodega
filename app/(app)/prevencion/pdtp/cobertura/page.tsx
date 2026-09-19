import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getActivePdtpProgram } from "@/lib/services/prevention-pdtp"
import { getPdtpCoverage } from "@/lib/services/prevention-risk-legal"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { PdtpCoverageWorkbench } from "./pdtp-coverage-workbench"

export const metadata: Metadata = { title: "Cobertura MIPER y legal" }

export default async function PdtpCoveragePage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")
  const program = await getActivePdtpProgram(currentPdtpPeriod().year)
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const coverage = program ? await getPdtpCoverage(program.id, access) : null
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Cobertura MIPER y legal"
        description="Demuestra de dónde nace cada medida del programa y qué brechas siguen abiertas."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "Cobertura" }]} />}
      />
      {!coverage ? (
        // A-4: la descripción ya decía qué hacer; faltaba que fuera clicable.
        <EmptyState
          title="Sin programa de trabajo (PDTP) activo"
          description="Crea y activa el programa del período para conciliarlo con MIPER y requisitos legales."
          action={
            <Button asChild size="sm">
              <Link href="/prevencion/pdtp/nuevo">Crear programa</Link>
            </Button>
          }
        />
      ) : (
        <PdtpCoverageWorkbench
          coverage={coverage}
          sourceOptions={{
            risk_control: coverage.sourceOptions.riskControls,
            legal_requirement: coverage.sourceOptions.legalRequirements,
            incident_capa: coverage.sourceOptions.capaActions,
            capacitacion: coverage.sourceOptions.trainingSessions,
            inspeccion: coverage.sourceOptions.inspectionRuns,
            audit: coverage.sourceOptions.audits,
            protocolo_minsal: coverage.sourceOptions.minsalProtocols,
            contractual_obligation: coverage.sourceOptions.coordinations,
            cphs: coverage.sourceOptions.committees,
            epp: coverage.sourceOptions.eppRequirements,
            emergencia: coverage.sourceOptions.emergencyPlans,
          }}
          worksites={coverage.worksites}
          canManage={can(session, "prevention:pdtp:program:manage")}
        />
      )}
    </PageContainer>
  )
}
