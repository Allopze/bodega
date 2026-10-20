import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  buildInspectionFollowupExportQuery,
  followupFilterIsActive,
  parseInspectionFollowupQuery,
} from "@/lib/prevention/inspection-followup-query"
import { listInspectionFollowup } from "@/lib/services/prevention-inspection-followup"
import { listInspectionWorksites } from "@/lib/services/prevention-inspections"
import { todayInChile } from "@/lib/utils"
import { FollowupTable } from "./followup-table"

export const metadata: Metadata = { title: "Seguimiento de inspecciones" }

export default async function InspectionFollowupPage({ searchParams }: {
  /** Filtros: `q`, `faena`, `estado` y `tipo`. Viajan al SQL y al enlace de descarga. */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden?desde=%2Fprevencion%2Finspecciones%2Fseguimiento") }
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const filter = parseInspectionFollowupQuery(await searchParams)
  // El mismo día para clasificar en el servidor y para rotular «Vencida» en la pantalla.
  const today = todayInChile()
  const [rows, worksites] = await Promise.all([
    listInspectionFollowup(access, filter, { order: "attention", today }),
    // Las faenas del alcance y no las de las filas: con una faena elegida las filas sólo traen esa.
    listInspectionWorksites(access),
  ])
  const canExport = session.user.permissions.includes("prevention:inspections:export")
  const canViewCapa = session.user.permissions.includes("prevention:capa:view")

  return <PageContainer>
    <PageHeader
      title="Seguimiento de inspecciones"
      description="Hallazgos con su acción CAPA y su avance, por faena."
      breadcrumb={<Breadcrumbs items={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Prevención" },
        { label: "Inspecciones", href: "/prevencion/inspecciones" },
        { label: "Seguimiento" },
      ]} />}
      // `<a download>` y no `<Link>`: es un archivo, no una ruta de la app, y lleva los filtros de la pantalla.
      actions={canExport ? <Button asChild variant="secondary"><a href={`/api/prevencion/inspecciones/seguimiento/export${buildInspectionFollowupExportQuery(filter)}`} download>Exportar Excel</a></Button> : undefined}
    />
    {rows.length === 0 && !followupFilterIsActive(filter) ? <EmptyState
      title="Aún no hay hallazgos para seguir"
      description="Cuando una inspección u observación levante una desviación, aparecerá aquí junto con su acción correctiva."
      action={<Button asChild><Link href="/prevencion/inspecciones">Ir a inspecciones</Link></Button>}
    /> : <FollowupTable rows={rows} worksites={worksites} filter={filter} today={today} canViewCapa={canViewCapa} />}
  </PageContainer>
}
