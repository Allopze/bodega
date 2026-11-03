import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolvePagination } from "@/lib/pagination"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCapaDashboardCounts, getCapaStatusCounts, listCapaActionsPage, listCapaWorksites } from "@/lib/services/prevention-capa"
import { CapaList } from "./capa-list"
import { ManualCapaDialog } from "./manual-capa-dialog"
import { capaLegacyVistaHref, parseCapaCondition, parseCapaStatusView } from "@/lib/prevention/capa-list-filters"

export const metadata: Metadata = { title: "Acciones CAPA" }

type SearchParams = { page?: string; status?: string; source?: string; worksite?: string; vista?: string }

export default async function CapaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("prevention:capa:view") }
  catch { redirect("/forbidden") }
  const scope = resolveWorksiteScope(session)
  const access = { scope, permissions: session.user.permissions }
  const raw = await searchParams
  // El tablero y los enlaces viejos publicaron `?vista=open` y `?vista=pending_verification`
  // cuando eran tarjetas; hoy son pestañas de estado.
  const legacyHref = capaLegacyVistaHref("/prevencion/capa", raw)
  if (legacyHref) redirect(legacyHref)
  const pageSize = 50
  // `resolvePagination` con `totalItems: 0` recorta cualquier página a la 1 (aún no se
  // sabe el total): el desplazamiento de la lista sale del parámetro tal cual y el total
  // real se resuelve después, para el paginador.
  const requestedPage = Number.parseInt(raw.page ?? "", 10)
  const offset = Number.isFinite(requestedPage) && requestedPage > 1 ? (requestedPage - 1) * pageSize : 0

  const status = parseCapaStatusView(raw.status)
  const source = raw.source && raw.source !== "all" ? raw.source : undefined
  const worksite = raw.worksite && raw.worksite !== "all" ? raw.worksite : undefined
  const quickFilter = parseCapaCondition(raw.vista)

  // Regla A5: cada dimensión se representa una vez. El estado son pestañas y las
  // tarjetas son condiciones que cruzan los estados (`vista`); cada contador se
  // calcula con los filtros de la URL MENOS su propia dimensión, y la lista con
  // todos, así que el número de una pestaña o tarjeta es lo que la lista muestra
  // al activarla.
  const shared = { sourceType: source, worksiteId: worksite }
  const [{ rows: actions, total }, worksites, counts, statusCounts] = await Promise.all([
    listCapaActionsPage({ ...access, ...shared, status, quickFilter, limit: pageSize, offset }),
    listCapaWorksites(access),
    getCapaDashboardCounts({ ...access, ...shared, status }),
    getCapaStatusCounts({ ...access, ...shared, quickFilter }),
  ])

  const resolvedPagination = resolvePagination({ pageParam: raw.page, totalItems: total, pageSize })

  return (
    <PageContainer>
      <PageHeader
        title="Acciones CAPA"
        description="Fuente común de acciones correctivas y preventivas, evidencia, eficacia y cierre."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Acciones CAPA" },
        ]} />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <a href="/api/prevencion/capa/export" download>Exportar Excel</a>
            </Button>
            {/* E2E-006: la pantalla no tenía creación; toda CAPA nacía en otro módulo. */}
            {session.user.permissions.includes("prevention:capa:manage") && <ManualCapaDialog worksites={worksites} />}
          </div>
        }
      />
      <CapaList actions={actions} worksites={worksites} counts={counts} statusCounts={statusCounts} pagination={resolvedPagination} />
    </PageContainer>
  )
}
