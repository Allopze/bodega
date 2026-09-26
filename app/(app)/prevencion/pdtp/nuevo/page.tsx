import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { getCurrentPdtpBase2026Version, listPdtpCopySourceCandidates, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { codeYear } from "@/lib/utils"
import { PdtpCreateProgramForm } from "./create-form"

export const metadata: Metadata = { title: "Nuevo programa PDTP" }

export default async function PdtpCreateProgramPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:program:manage")) redirect("/forbidden")

  const [existingPrograms, copyCandidates, base] = await Promise.all([
    listPdtpPrograms(),
    listPdtpCopySourceCandidates(),
    getCurrentPdtpBase2026Version(),
  ])
  const existingYearSet = new Set(existingPrograms.map((program) => program.year))
  let suggestedYear = codeYear()
  while (existingYearSet.has(suggestedYear)) suggestedYear++
  const snapshot = base?.version.snapshotJson as { activities?: unknown[] } | undefined

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo programa preventivo"
        description="Crea el programa anual copiando la versión vigente del año anterior o desde la Base preventiva 2026."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <PdtpCreateProgramForm
        suggestedYear={suggestedYear}
        existingPrograms={existingPrograms.map((program) => ({
          year: program.year,
          id: program.id,
          version: program.version,
          status: program.status,
          creationMode: program.creationMode,
        }))}
        copyCandidates={copyCandidates}
        baseRevision={base ? {
          version: base.version.version,
          activityCount: Array.isArray(snapshot?.activities) ? snapshot.activities.length : 0,
          contentDigest: base.version.contentDigest,
        } : null}
      />
    </PageContainer>
  )
}
