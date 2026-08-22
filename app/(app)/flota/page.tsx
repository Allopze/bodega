import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { Button } from "@/components/ui/button"
import { ServerPagination } from "@/components/ui/server-pagination"
import { can, requirePermission } from "@/lib/auth/can"
import { getFleetOverviewPage } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, formatCLP, todayInChile } from "@/lib/utils"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { FleetFilters } from "./fleet-filters"
import { FleetTable } from "./fleet-table"
import { FleetExportButton } from "./fleet-export-button"

export const metadata: Metadata = { title: "Flota" }

const NUMBER_FORMATTER = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })
const formatNumber = (value: number) => NUMBER_FORMATTER.format(value)
const FLEET_PAGE_SIZE = 25

export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewFuel = can(session, "combustibles:view")
  const canViewMaintenance = can(session, "mantenciones:view")

  const fleetSettings = await getFleetAdminSettings()
  const sp = await searchParams
  const filterEstado = typeof sp.estado === "string" ? sp.estado : undefined
  const filterResponsable = typeof sp.responsable === "string" ? sp.responsable : undefined
  const filterVencimiento = typeof sp.vencimiento === "string" ? sp.vencimiento : undefined
  const q = typeof sp.q === "string" ? sp.q.slice(0, 160) : undefined
  const requestedPage = typeof sp.page === "string" && /^\d+$/.test(sp.page) ? Math.max(1, Number(sp.page)) : 1

  const warningDays = fleetSettings.warningDays
  // Las columnas de vencimiento son fechas civiles chilenas: medirlas con
  // `toISOString()` (siempre UTC) adelantaba el corte del día y marcaba como
  // vencido, entre las 20:00 y la medianoche, lo que vence hoy.
  const today = todayInChile()
  const warningWindowEnd = addDaysToPlainDate(today, warningDays)

  const filters = {
    operationalStatus: filterEstado,
    responsibleName: filterResponsable,
    expiry: filterVencimiento as "vencidos" | "proximos" | "al-dia" | undefined,
    q,
  }
  const initialPageData = await getFleetOverviewPage(session, filters, { today, warningWindowEnd }, {
    offset: (requestedPage - 1) * FLEET_PAGE_SIZE,
    limit: FLEET_PAGE_SIZE,
  })
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: initialPageData.total, pageSize: FLEET_PAGE_SIZE })
  const pageData = pagination.offset === initialPageData.offset
    ? initialPageData
    : await getFleetOverviewPage(session, filters, { today, warningWindowEnd }, {
        offset: pagination.offset,
        limit: pagination.limit,
      })
  const pageHref = (page: number) => buildPaginationHref("/flota", sp, page)

  // Extract unique filter options from vehicles
  const operationalStatuses = [...new Set(pageData.index.flatMap((v) => v.operationalStatus ? [v.operationalStatus] : []))]
  const responsibleUsers = [...new Map(
    pageData.index.filter((v) => v.responsibleName).map((v) => [v.responsibleName, { id: v.responsibleName!, name: v.responsibleName! }])
  ).values()]

  // Sobre el conjunto filtrado, no sobre el total: con un filtro activo la fila
  // de cifras contradecía a la tabla que tiene debajo.
  const active = pageData.summary.active
  const totalCost = pageData.summary.totalOperationalCost
  const totalLiters = pageData.summary.totalLiters
  const maintenanceCount = pageData.summary.maintenanceCount

  const expiredVehicles = pageData.matching.filter((vehicle) => vehicle.nextExpiryDate && vehicle.nextExpiryDate < today)
  const expiringSoon = pageData.matching.filter((vehicle) =>
    vehicle.nextExpiryDate &&
    vehicle.nextExpiryDate >= today &&
    vehicle.nextExpiryDate <= warningWindowEnd,
  )
  // El servicio agrega combustible y mantenciones de los últimos 12 meses
  // (lib/services/fleet.ts): la etiqueta lo dice para que la cifra no se lea
  // como el histórico completo del vehículo.
  const summaryStats: SummaryStat[] = [
    { key: "active", label: "Vehículos activos", value: active },
    ...(totalCost != null ? [{ key: "cost", label: "Costo operacional (12 meses)", value: formatCLP(totalCost) }] : []),
    ...(totalLiters != null ? [{ key: "liters", label: "Litros registrados (12 meses)", value: formatNumber(totalLiters) }] : []),
    ...(maintenanceCount != null ? [{ key: "maintenance", label: "Mantenciones (12 meses)", value: maintenanceCount }] : []),
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Flota"
        description={canViewCosts && (canViewFuel || canViewMaintenance) ? "Catálogo operativo de vehículos con costos autorizados, mantenciones, lecturas y vencimientos." : "Catálogo operativo de vehículos, mantenciones, lecturas y vencimientos."}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/" },
            { label: "Flota" },
          ]} />
        }
        actions={<div className="flex items-center gap-2">
          <FleetExportButton filters={{ operationalStatus: filterEstado, responsibleName: filterResponsable, expiry: filterVencimiento as "vencidos" | "proximos" | "al-dia" | undefined, q }} />
          {can(session, "combustibles:manage_vehicles") && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/admin/flota-catalogos/vehiculos">Gestionar vehículos</Link>
            </Button>
          )}
        </div>}
      />

      <SummaryBar stats={summaryStats} />

      {(expiredVehicles.length > 0 || expiringSoon.length > 0) && (
        <div className="flex flex-col gap-2">
          {expiredVehicles.length > 0 && (
            <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">
              <strong>Documentos vencidos:</strong>{" "}
              {expiredVehicles.map((v) => v.plate).join(", ")}
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
              <strong>Próximos a vencer ({warningDays} días):</strong>{" "}
              {expiringSoon.map((v) => v.plate).join(", ")}
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros avanzados</CardTitle>
        </CardHeader>
        <CardContent>
          <FleetFilters
            operationalStatuses={operationalStatuses}
            responsibleUsers={responsibleUsers}
            current={{ estado: filterEstado, responsable: filterResponsable, vencimiento: filterVencimiento, q }}
            warningDays={warningDays}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vehículos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <FleetTable vehicles={pageData.rows} hasAnyVehicle={pageData.index.length > 0} canViewCosts={canViewCosts} canViewFuel={canViewFuel} canViewMaintenance={canViewMaintenance} />
        </CardContent>
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </Card>
    </PageContainer>
  )
}
