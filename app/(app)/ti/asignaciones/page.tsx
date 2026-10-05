import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssetAssignments, itAssets, workers, worksites } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import {
  countAssignmentAlerts, getAssignmentsAccessories, getAssignmentsPhotos, listAssignments,
} from "@/lib/services/ti/assignments"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { AssignmentsTable, type DeliveryReferenceMap } from "./assignments-table"
import { AssignmentCta } from "./assignment-sheet"
import { AssignmentFilters } from "./assignment-filters"

export const metadata: Metadata = { title: "Entregas" }

export default async function AsignacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const sp = await searchParams
  const onlyActive = sp.estado === "vigentes"
  const pendingAcceptance = sp.acuse === "pendiente"
  const overdueLoans = sp.prestamo === "vencido"

  const scope = worksiteScopeSql(session, itAssetAssignments.worksiteId)
  // Trabajadores y faenas van acotados igual que en /ti/activos y /ti/tickets:
  // sin esto un rol de faena veía la nómina completa en los desplegables y
  // elegía trabajadores que el servicio después rechazaba.
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const [workersList, worksitesList, assetOptions] = await Promise.all([
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName, worksiteId: workers.worksiteId })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    listAssetOptions(worksiteScopeSql(session, itAssets.worksiteId)),
  ])

  // Una faena fuera del alcance (o inventada en la URL) se ignora: el listado
  // ya está acotado por `scope`, así que el filtro nunca podría ensanchar nada,
  // pero así el selector no queda apuntando a una opción que no existe.
  const faenaParam = typeof sp.faena === "string" ? sp.faena : ""
  const worksiteId = worksitesList.some((worksite) => worksite.id === faenaParam) ? faenaParam : undefined

  const [assignments, alertCounts] = await Promise.all([
    listAssignments({
      status: onlyActive ? "active" : undefined,
      pendingAcceptance,
      overdueLoans,
      worksiteId,
      scope,
    }),
    countAssignmentAlerts({ worksiteId, scope }),
  ])

  // TIUX-48: la devolución muestra cómo se entregó el equipo. Solo las custodias
  // abiertas se devuelven, así que solo ellas necesitan accesorios y fotos.
  const openIds = assignments.filter((row) => !row.returnedAt).map((row) => row.id)
  const [accessoriesById, photosById] = await Promise.all([
    getAssignmentsAccessories(openIds),
    getAssignmentsPhotos(openIds),
  ])
  const references: DeliveryReferenceMap = {}
  for (const row of assignments) {
    if (row.returnedAt) continue
    const accessories = accessoriesById.get(row.id) ?? []
    references[row.id] = {
      accessories: accessories.map((a) => ({ id: a.id, name: a.name, returnedAt: a.returnedAt })),
      reference: {
        deliveredAt: row.deliveredAt,
        physicalState: row.physicalState,
        accessories: accessories.map((a) => a.name),
        photos: (photosById.get(row.id) ?? [])
          .filter((photo) => photo.stage === "delivery")
          .map((photo) => ({ id: photo.id, caption: photo.caption })),
      },
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Entregas"
        description="Equipos entregados, préstamos, devoluciones y transferencias, con su acta."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Entregas" }]} />}
        actions={canManage ? (
          <AssignmentCta workers={workersList} worksites={worksitesList} assets={assetOptions} />
        ) : undefined}
      />

      <AssignmentFilters worksites={worksitesList} counts={alertCounts} />

      <AssignmentsTable
        rows={assignments}
        canManage={canManage}
        workers={workersList}
        worksites={worksitesList}
        references={references}
        hasFilters={onlyActive || pendingAcceptance || overdueLoans || Boolean(worksiteId)}
      />
    </PageContainer>
  )
}
