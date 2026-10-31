import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, desc, eq, inArray, type AnyColumn } from "drizzle-orm"
import { db } from "@/db"
import { fuelStorageLocations, fuelTaeLoadingPoints, fuelTaePublicLinks, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { LoadingPointsPanel } from "./loading-points-panel"
import { NewLoadingPointButton } from "./new-loading-point-button"
import { activeLinksByPoint, type LoadingPointRow, type PublicLinkRow, type StorageOption, type WorksiteOption } from "./point-types"

export const metadata: Metadata = { title: "Puntos de carga y QR" }

async function load<T>(promise: Promise<T>, fallback: T, label: string): Promise<{ value: T; failed: boolean }> {
  const failed = Symbol("failed")
  const value = await settle<T | typeof failed>(promise, failed, label)
  return value === failed ? { value: fallback, failed: true } : { value: value as T, failed: false }
}

export default async function AjustesPuntosDeCargaPage() {
  let session
  try { session = await requirePermission("combustibles:tae_manage_config", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const scope = resolveWorksiteScope(session)
  const none = scope.mode === "none"
  const worksiteFilter = (column: AnyColumn) => scope.mode === "some" ? inArray(column, scope.ids) : undefined

  const [worksiteRows, pointRows, storageRows, linkRows] = await Promise.all([
    load(
      none ? Promise.resolve([]) : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(and(eq(worksites.isActive, true), worksiteFilter(worksites.id))).orderBy(asc(worksites.name)),
      [] as WorksiteOption[], "ajustes-puntos-faenas",
    ),
    load(
      none ? Promise.resolve([]) : db.select({
        id: fuelTaeLoadingPoints.id, worksiteId: fuelTaeLoadingPoints.worksiteId, worksiteName: worksites.name, name: fuelTaeLoadingPoints.name,
        type: fuelTaeLoadingPoints.type, isActive: fuelTaeLoadingPoints.isActive, storageLocationId: fuelTaeLoadingPoints.storageLocationId,
      }).from(fuelTaeLoadingPoints).innerJoin(worksites, eq(worksites.id, fuelTaeLoadingPoints.worksiteId))
        .where(worksiteFilter(fuelTaeLoadingPoints.worksiteId)).orderBy(asc(worksites.name), asc(fuelTaeLoadingPoints.name)),
      [] as Array<Omit<LoadingPointRow, "activeLinks">>, "ajustes-puntos",
    ),
    load(
      none ? Promise.resolve([]) : db.select({ id: fuelStorageLocations.id, worksiteId: fuelStorageLocations.worksiteId, name: fuelStorageLocations.name }).from(fuelStorageLocations)
        .where(and(eq(fuelStorageLocations.isActive, true), worksiteFilter(fuelStorageLocations.worksiteId))).orderBy(asc(fuelStorageLocations.name)),
      [] as StorageOption[], "ajustes-puntos-estanques",
    ),
    load(
      none ? Promise.resolve([]) : db.query.fuelTaePublicLinks.findMany({
        where: scope.mode === "some" ? inArray(fuelTaePublicLinks.worksiteId, scope.ids) : undefined,
        with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } } },
        orderBy: [desc(fuelTaePublicLinks.createdAt)],
      }),
      [], "ajustes-puntos-enlaces",
    ),
  ])

  const counts = activeLinksByPoint(linkRows.value)
  const points: LoadingPointRow[] = pointRows.value.map((point) => ({ ...point, activeLinks: counts.get(point.id) ?? 0 }))
  const links: PublicLinkRow[] = linkRows.value.map((link) => ({
    id: link.id,
    label: link.label,
    worksiteName: link.worksite?.name ?? "—",
    loadingPointName: link.loadingPoint?.name ?? null,
    createdAt: link.createdAt,
    lastUsedAt: link.lastUsedAt,
    revokedAt: link.revokedAt,
  }))
  const sources = [worksiteRows, pointRows, storageRows, linkRows]
  const degraded = sources.filter((source) => source.failed).length

  return (
    <PageContainer>
      <PageHeader
        title="Puntos de carga y QR"
        description="Dónde se carga combustible y el QR de cada punto"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Puntos de carga y QR" }]} />}
        actions={<FuelHeaderActions><NewLoadingPointButton worksites={worksiteRows.value} storageLocations={storageRows.value} /></FuelHeaderActions>}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={Array.from({ length: degraded }, () => "fuente")} total={sources.length} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          Cada QR abre el formulario en terreno de un punto de carga. Se muestra una sola vez; si se pierde, revoca el enlace y genera otro.
        </p>
        {degraded > 0 && points.length === 0 ? null : (
          <LoadingPointsPanel
            points={points}
            links={links}
            storageLocations={storageRows.value}
            emptyAction={<NewLoadingPointButton worksites={worksiteRows.value} storageLocations={storageRows.value} label="Crear el primer punto de carga" withIcon={false} />}
          />
        )}
      </div>
    </PageContainer>
  )
}
