import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { listInspectionTemplates } from "@/lib/services/prevention-inspections"
import { listInspectionRuns, listBehavioralObservations } from "@/lib/services/prevention-inspections"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { worksites, inspectionTemplates } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { InspectionList } from "./inspection-list"

export const metadata: Metadata = { title: "Inspecciones y observaciones" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function InspeccionesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:inspections:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const [templates, runs, observations] = await Promise.all([
    listInspectionTemplates(),
    listInspectionRuns(scope),
    listBehavioralObservations(scope),
  ])

  // Enrichir runs con el nombre de la plantilla y de la faena para no mostrar
  // IDs crudos al usuario (audit §2 / §3 P2.6).
  const templateIds = Array.from(new Set(runs.map((r) => r.templateId)))
  const worksiteIds = Array.from(new Set([
    ...runs.map((r) => r.worksiteId),
    ...observations.map((o) => o.worksiteId),
  ]))
  const [tplRows, wsRows] = await Promise.all([
    templateIds.length ? db.select({ id: inspectionTemplates.id, title: inspectionTemplates.title }).from(inspectionTemplates).where(inArray(inspectionTemplates.id, templateIds)) : Promise.resolve([] as Array<{ id: string; title: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])
  const tplNameById = new Map(tplRows.map((t) => [t.id, t.title]))
  const wsNameById = new Map(wsRows.map((w) => [w.id, w.name]))

  const enrichedRuns = runs.map((r) => ({ ...r, templateTitle: tplNameById.get(r.templateId) ?? r.templateId, worksiteName: wsNameById.get(r.worksiteId) ?? r.worksiteId }))
  const enrichedObs = observations.map((o) => ({ ...o, worksiteName: wsNameById.get(o.worksiteId) ?? o.worksiteId }))

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Inspecciones" }]} />
      <PageHeader
        title="Inspecciones"
        description="Inspecciones planificadas y observaciones conductuales"
        actions={<PreventionExportButton href="/api/prevencion/inspecciones/export" label="Exportar inspecciones" />}
      />
      <InspectionList templates={templates} runs={enrichedRuns} observations={enrichedObs} canManage={can(session, "prevention:inspections:manage")} />
    </PageContainer>
  )
}
