import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { and, asc, eq, inArray } from "drizzle-orm"
import { GasPump } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelTaeLoadingPoints, worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { settle } from "@/lib/async-settle"
import { buildFieldLoadConfig } from "@/lib/services/fuel-tae"
import { pastLoadWindow } from "@/lib/combustibles/field-load-rules"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { RegistrarForm } from "./registrar-form"

export const metadata: Metadata = { title: "Registrar carga" }

type SearchParams = Record<string, string | string[] | undefined>
type WorksiteRow = { id: string; name: string }
type PointRow = { id: string; name: string; worksiteId: string }

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export default async function RegistrarCargaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:register_load", FUEL_PATHS.registrar) } catch { redirect("/forbidden") }

  const raw = await searchParams
  const scope = resolveWorksiteScope(session)
  const [worksitesResult, pointsResult] = await Promise.all([
    settle<WorksiteRow[] | null>(
      scope.mode === "none"
        ? Promise.resolve([] as WorksiteRow[])
        : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
          .where(and(eq(worksites.isActive, true), scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined))
          .orderBy(asc(worksites.name)),
      null,
      "registrar-worksites",
    ),
    settle<PointRow[] | null>(
      db.select({ id: fuelTaeLoadingPoints.id, name: fuelTaeLoadingPoints.name, worksiteId: fuelTaeLoadingPoints.worksiteId })
        .from(fuelTaeLoadingPoints)
        .where(and(eq(fuelTaeLoadingPoints.isActive, true), worksiteScopeSql(session, fuelTaeLoadingPoints.worksiteId)))
        .orderBy(asc(fuelTaeLoadingPoints.name)),
      null,
      "registrar-loading-points",
    ),
  ])
  const worksiteOptions = worksitesResult ?? []
  const points = pointsResult ?? []
  const degraded = [worksitesResult === null ? "faenas" : null, pointsResult === null ? "puntos de carga" : null].filter((item): item is string => item !== null)

  // La faena y el punto vienen de la URL, pero sólo valen si el usuario puede operar la faena y el
  // punto es de ella: el alcance se decide aquí, no en el selector. Una faena sola, o un único punto
  // en la faena, quedan elegidos sin preguntar.
  let worksiteId = first(raw.faena)
  if (!worksiteId || !canAccessWorksite(session, worksiteId) || !worksiteOptions.some((worksite) => worksite.id === worksiteId)) {
    worksiteId = worksiteOptions.length === 1 ? worksiteOptions[0]!.id : ""
  }
  const worksitePoints = points.filter((point) => point.worksiteId === worksiteId)
  let pointId = first(raw.punto)
  if (!worksitePoints.some((point) => point.id === pointId)) pointId = worksitePoints.length === 1 ? worksitePoints[0]!.id : ""

  const config = worksiteId && pointId
    ? await settle(buildFieldLoadConfig(worksiteId, pointId), null, "registrar-config")
    : null

  const canRegisterPast = can(session, "combustibles:register_past_load")
  const canManagePoints = can(session, "combustibles:tae_manage_config")
  const noPoints = worksiteOptions.length === 0 || (pointsResult !== null && points.length === 0)

  return (
    <PageContainer width="form">
      <PageHeader
        title="Registrar carga"
        description="Anota una carga de combustible hecha a un equipo, paso a paso"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Registrar" }]} />}
        actions={<FuelHeaderActions />}
      />
      <DegradedDataBanner degraded={degraded} total={2} />

      {noPoints ? (
        <EmptyState
          icon={<GasPump size={24} />}
          title="Aún no hay puntos de carga para registrar"
          description={canManagePoints
            ? "Para registrar una carga hace falta una faena a tu alcance con un punto de carga activo (surtidor, camión surtidor, bidón…). Se crean en Ajustes."
            : "Para registrar una carga hace falta una faena a tu alcance con un punto de carga activo (surtidor, camión surtidor, bidón…). Pídele a quien administra Combustible que cree uno en Ajustes."}
          action={
            <Button asChild variant="secondary" size="sm">
              {canManagePoints
                ? <Link href={FUEL_PATHS.ajustesPuntos}>Ir a Puntos de carga</Link>
                : <Link href={FUEL_PATHS.cargas}>Volver a Cargas</Link>}
            </Button>
          }
        />
      ) : (
        <RegistrarForm
          worksites={worksiteOptions}
          points={points.map((point) => ({ id: point.id, name: point.name, worksiteId: point.worksiteId }))}
          worksiteId={worksiteId}
          pointId={pointId}
          config={config}
          pastWindow={canRegisterPast ? pastLoadWindow() : null}
          canView={can(session, "combustibles:view")}
        />
      )}
    </PageContainer>
  )
}
