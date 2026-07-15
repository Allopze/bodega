import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listPdtpPrograms, getPdtpComplianceIndicators, getPdtpProgramActivityCount } from "@/lib/services/prevention-pdtp"
import { getActivePdtpProgram } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpCreateProgramForm } from "./create-form"

export const metadata: Metadata = { title: "Nuevo programa PDTP" }

const CURRENT_YEAR = new Date().getFullYear()

export default async function PdtpCreateProgramPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:manage")) redirect("/forbidden")

  const existingPrograms = await listPdtpPrograms()

  // Enriquecer con compliance + conteo de actividades para las mini-cards
  const [activeProgram, enrichedEntries] = await Promise.all([
    getActivePdtpProgram(CURRENT_YEAR),
    Promise.all(existingPrograms.map(async (p) => {
      const [indicators, activityCount] = await Promise.all([
        getPdtpComplianceIndicators(p.id).catch(() => null),
        getPdtpProgramActivityCount(p.id),
      ])
      return {
        id: p.id, title: p.title, year: p.year, version: p.version, status: p.status,
        compliancePercent: indicators?.annual?.percent !== null
          ? Math.round((indicators?.annual?.percent ?? 0) * 100)
          : null,
        activityCount,
      }
    })),
  ])

  // Si hay un programa activo este año, sugerir el año siguiente
  const suggestedYear = activeProgram ? CURRENT_YEAR + 1 : CURRENT_YEAR

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo programa preventivo"
        description="Crea un nuevo programa de trabajo preventivo para un año específico."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <PdtpCreateProgramForm
        userId={session.user.id}
        existingPrograms={enrichedEntries}
        suggestedYear={suggestedYear}
        hasActiveProgram={!!activeProgram}
      />
    </PageContainer>
  )
}
