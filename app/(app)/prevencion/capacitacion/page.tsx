import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listTrainingOccurrences, listTrainingOccurrenceWorksites } from "@/lib/services/prevention-training-occurrences"
import { resolvePredefinedTrainingCatalogYear } from "@/lib/prevention/training-occurrences-catalog"
import { TrainingOccurrenceList } from "./training-occurrence-list"

export const metadata: Metadata = { title: "Capacitación" }

export default async function CapacitacionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const params = await searchParams
  const year = resolvePredefinedTrainingCatalogYear(params?.year)
  const rawWorksiteId = params?.faena
  const worksiteId =
    typeof rawWorksiteId === "string"
      ? rawWorksiteId.trim()
      : Array.isArray(rawWorksiteId)
        ? (rawWorksiteId[0]?.trim() ?? "")
        : ""
  const exportParams = new URLSearchParams({ year: String(year) })
  if (worksiteId) exportParams.set("faena", worksiteId)
  const [occurrences, worksites] = await Promise.all([
    listTrainingOccurrences(access, {
      year,
      worksiteId: worksiteId || undefined,
      includeInactiveWorksites: Boolean(worksiteId),
    }),
    listTrainingOccurrenceWorksites(access),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Capacitación"
        description="Control anual de cursos y campañas por faena. Marca cada actividad como hecha o no hecha y conserva su evidencia."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:training:export") ? (
            <Button asChild variant="secondary">
              <a href={`/api/prevencion/capacitacion/export?${exportParams.toString()}`} download>Exportar Excel</a>
            </Button>
          ) : undefined
        }
      />
      <TrainingOccurrenceList
        rows={occurrences}
        worksites={worksites}
        selectedYear={year}
        selectedWorksiteId={worksiteId}
        canRecord={session.user.permissions.includes("prevention:training:record")}
      />
    </PageContainer>
  )
}
