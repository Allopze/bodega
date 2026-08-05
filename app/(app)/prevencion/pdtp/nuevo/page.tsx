import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { getCurrentPdtpBase2026Version, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpCreateProgramForm } from "./create-form"

export const metadata: Metadata = { title: "Nuevo programa PDTP" }

export default async function PdtpCreateProgramPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:program:manage")) redirect("/forbidden")

  const [existingPrograms, base] = await Promise.all([
    listPdtpPrograms(),
    getCurrentPdtpBase2026Version(),
  ])
  const existingYears = existingPrograms.map((program) => program.year)
  const existingYearSet = new Set(existingYears)
  let suggestedYear = new Date().getFullYear()
  while (existingYearSet.has(suggestedYear)) suggestedYear++
  const snapshot = base?.version.snapshotJson as { activities?: unknown[] } | undefined

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo programa preventivo"
        description="Crea el programa anual desde la Base preventiva 2026."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <PdtpCreateProgramForm
        suggestedYear={suggestedYear}
        existingYears={existingYears}
        baseRevision={base ? {
          version: base.version.version,
          activityCount: Array.isArray(snapshot?.activities) ? snapshot.activities.length : 0,
          contentDigest: base.version.contentDigest,
        } : null}
      />
    </PageContainer>
  )
}
