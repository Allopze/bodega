import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { MaterialEnvironmentalDashboard } from "./material-environmental-dashboard"
import { ExportMaterialAmbientalButton } from "./material-environmental-export-button"
import { getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"

export const metadata: Metadata = { title: "Daño material y ambiental" }

type PageProps = {
  searchParams: Promise<{ year?: string }>
}

export default async function MaterialAmbientalPage({ searchParams }: PageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:indicadores:view")) redirect("/forbidden")

  const query = await searchParams
  const currentYear = new Date().getFullYear()
  const year = Number(query.year) || currentYear

  const { worksites, eventData } = await getMaterialEnvironmentalEvents(year, resolveWorksiteScope(session))

  return (
    <PageContainer>
      <PageHeader
        title="Daño material y ambiental"
        description="Conteo canónico de incidentes peligrosos, daños materiales y derrames ambientales por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Daño material y ambiental" },
          ]} />
        }
        actions={<ExportMaterialAmbientalButton year={year} />}
      />
      <MaterialEnvironmentalDashboard
        worksites={worksites}
        eventData={eventData}
        year={year}
        currentYear={currentYear}
      />
    </PageContainer>
  )
}
