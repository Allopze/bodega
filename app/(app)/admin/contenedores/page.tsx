import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listContainers, listWorksitesForContainers } from "@/lib/services/prevention-containers"
import { ContainerList, ContainerPageActions, type ContainerRow } from "./container-list"

export const metadata: Metadata = { title: "Catálogo de contenedores" }

/**
 * Padrón de los contenedores instalados en cada faena.
 *
 * Vive en Administración y no en Prevención porque es dato maestro: el
 * contenedor existe por la operación, y Prevención sólo lo consume para
 * inspeccionarlo. Antes no existía padrón alguno y el contenedor se nombraba
 * escribiendo texto libre en cada inspección, así que nadie podía responder qué
 * inspecciones acumulaba una unidad concreta.
 */
export default async function ContenedoresPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "admin:containers")) redirect("/forbidden")

  const access = {
    userId: session.user.id,
    permissions: session.user.permissions,
    scope: serviceWorksiteScope(session),
  }
  const [rows, worksites] = await Promise.all([
    listContainers(access),
    listWorksitesForContainers(access),
  ])

  const containers: ContainerRow[] = rows.map((row) => ({
    id: row.container.id,
    worksiteId: row.container.worksiteId,
    worksiteName: row.worksiteName,
    code: row.container.code,
    location: row.container.location,
    status: row.container.status,
    notes: row.container.notes,
    isActive: row.container.isActive,
    version: row.container.version,
    inspectionCount: row.inspectionCount,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de contenedores"
        description="Padrón de los contenedores de cada faena. Prevención los inspecciona eligiéndolos de acá; el alta y el traslado se hacen en esta pantalla."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Contenedores" },
        ]} />}
        actions={<ContainerPageActions worksites={worksites} canManage />}
      />
      <ContainerList rows={containers} worksites={worksites} canManage />
    </PageContainer>
  )
}
