import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, desc, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { buildConsumptionWhere } from "@/lib/combustibles/consumption-queries"
import { inboxDueDate } from "@/lib/combustibles/inbox/types"
import { FUEL_CARRY_PARAMS, monthlyGranularityNote, toStatementMonths } from "@/lib/combustibles/period"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, fuelBatchHref, fuelEquipmentHref, fuelInboxHref, withFuelContext } from "@/lib/combustibles/routes"
import { cargasNavItems } from "@/lib/combustibles/section-nav"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { ConsumptionDetailTable, type ConsumptionRecordRow } from "../../consumption-detail-table"
import { TarjetasFilters } from "./tarjetas-filters"

export const metadata: Metadata = { title: "Tarjetas (total por patente y mes)" }

type SearchParams = Record<string, string | string[] | undefined>

const PAGE_SIZE = 50

function first(sp: SearchParams, key: string): string | undefined {
  const raw = sp[key]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value || undefined
}

/**
 * Tarjetas (total por patente y mes): lo que informa Copec, antes la
 * vista «Registros» de la raíz del módulo. Cada fila es un total mensual por
 * patente, no una carga: por eso va aparte de «Cargas a equipos». El período es
 * en meses: con una semana o un rango se muestran los meses completos que toca.
 */
export default async function CargasTarjetasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.cargas) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const months = toStatementMonths(period)
  const firstMonth = months[0] ?? period.from.slice(0, 7)
  const lastMonth = months[months.length - 1] ?? period.to.slice(0, 7)

  const worksiteId = first(sp, "faena")
  const fuente = first(sp, "fuente") ?? first(sp, "proveedor")
  const search = first(sp, "patente")?.slice(0, 60)
  const unlinkedOnly = first(sp, "sin_vincular") === "si"
  const page = Number.parseInt(first(sp, "pagina") ?? first(sp, "page") ?? "1", 10)
  const canViewCosts = can(session, "combustibles:view_costs")

  const degraded: string[] = []
  let tracked = 0
  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
    tracked++
    return promise.catch((error: unknown) => {
      logger.error(`[cargas-tarjetas] ${label} falló`, error)
      degraded.push(label)
      return fallback
    })
  }

  const scope = resolveWorksiteScope(session)
  // El período en meses completos y el alcance de faena los aplica `buildConsumptionWhere`; la búsqueda mira la patente o el equipo.
  const base = buildConsumptionWhere(session, {
    fromDate: `${firstMonth}-01`,
    toDate: inboxDueDate(lastMonth),
    worksiteId,
    fuente,
    associated: unlinkedOnly ? "no" : undefined,
  })
  const pattern = search ? `%${search.replace(/[%_\\]/g, "\\$&")}%` : null
  const where = pattern
    ? sql`${base ? sql`(${base}) and ` : sql``}(${fuelConsumptionRecords.patente} ilike ${pattern} or exists (select 1 from fuel_vehicles fv where fv.id = ${fuelConsumptionRecords.vehicleId} and (fv.code ilike ${pattern} or fv.plate ilike ${pattern})))`
    : base

  const [worksitesList, fuentesRows, total] = await Promise.all([
    track(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        columns: { id: true, name: true },
        orderBy: [worksites.name],
      }),
      [] as Array<{ id: string; name: string }>, "faenas",
    ),
    settle(db.selectDistinct({ fuente: fuelConsumptionRecords.fuente }).from(fuelConsumptionRecords).where(and(
      isNotNull(fuelConsumptionRecords.fuente),
      // El selector de proveedor no puede ofrecer fuentes de una faena fuera del
      // alcance: además de filtrar de más, revelaba nombres de otras faenas (6.5).
      worksiteScopeSql(session, fuelConsumptionRecords.worksiteId),
    )), [] as Array<{ fuente: string | null }>, "tarjetas-proveedores"),
    track(db.select({ count: sql<number>`count(*)::int` }).from(fuelConsumptionRecords).where(where).then((result) => result[0]?.count ?? 0), 0, "total"),
  ])
  const countDegraded = degraded.includes("total")
  const pagination = resolvePagination({ pageParam: String(Number.isFinite(page) && page > 0 ? page : 1), totalItems: total, pageSize: PAGE_SIZE })

  const rowsRaw = await track(
    db.query.fuelConsumptionRecords.findMany({
      where,
      columns: {
        id: true,
        batchId: true,
        patente: true,
        numeroTarjetas: true,
        numeroTransacciones: true,
        cantidadUnidad: true,
        monto: canViewCosts,
        precioPromedioUnidad: canViewCosts,
        rendimientoPromedio: true,
        periodoDesde: true,
        periodoHasta: true,
        fuente: true,
      },
      with: { vehicle: { columns: { id: true, plate: true, type: true } } },
      orderBy: [desc(fuelConsumptionRecords.periodoDesde), asc(fuelConsumptionRecords.patente), desc(fuelConsumptionRecords.createdAt)],
      limit: PAGE_SIZE,
      offset: pagination.offset,
    }),
    [],
    "filas",
  )

  // El archivo lo abre quien importa (las filas ya están acotadas a sus faenas); si no, la fila no ofrece un enlace que terminaría en «sin permiso».
  const canOpenBatch = can(session, "combustibles:import")
  const context = (href: string) => withFuelContext(href, sp)
  const redactAmount = (value: unknown) => (canViewCosts && typeof value === "number" ? value : null)
  const rows: ConsumptionRecordRow[] = rowsRaw.map((row) => ({
    id: row.id,
    batchId: row.batchId,
    patente: row.patente,
    numeroTarjetas: row.numeroTarjetas,
    numeroTransacciones: row.numeroTransacciones,
    cantidadUnidad: row.cantidadUnidad,
    monto: redactAmount((row as { monto?: unknown }).monto),
    precioPromedioUnidad: redactAmount((row as { precioPromedioUnidad?: unknown }).precioPromedioUnidad),
    rendimientoPromedio: row.rendimientoPromedio,
    periodoDesde: row.periodoDesde,
    periodoHasta: row.periodoHasta,
    fuente: row.fuente,
    vehicle: row.vehicle,
    equipmentHref: row.vehicle ? context(fuelEquipmentHref(row.vehicle.id)) : null,
    batchHref: canOpenBatch ? context(fuelBatchHref("tarjeta", row.batchId)) : null,
  }))

  const fuentes = fuentesRows.map((row) => row.fuente).filter((value): value is string => Boolean(value)).sort()
  const granularityNote = monthlyGranularityNote(period)
  const hrefForPage = (target: number) => buildPaginationHref(FUEL_PATHS.tarjetas, { ...sp, page: undefined }, target, "pagina")

  return (
    <PageContainer>
      <PageHeader
        title="Tarjetas (total por patente y mes)"
        description="Lo que informa Copec por patente y mes"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Tarjetas" }]} />}
        actions={<FuelHeaderActions period={period} granularity="month" />}
      />
      <SectionNav items={cargasNavItems()} activeKey="tarjetas" ariaLabel="Vistas de cargas" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={tracked} />

      <div className="mb-4 space-y-2">
        <Callout tone="info" role="status" title="Las tarjetas informan un total por patente y por mes, no cada carga">
          Por eso van aparte de las cargas a equipos. Copec se actualiza automáticamente cada mañana.
          {granularityNote ? <span className="mt-1 block">{granularityNote}</span> : null}
        </Callout>
      </div>

      <TarjetasFilters
        worksites={worksitesList.map((item) => ({ value: item.id, label: item.name }))}
        suppliers={fuentes.map((name) => ({ value: name, label: name }))}
      />

      <ConsumptionDetailTable
        rows={rows}
        pagination={pagination}
        hrefForPage={hrefForPage}
        canViewCosts={canViewCosts}
        unlinkedHref={context(fuelInboxHref({ tipo: "patente" }))}
        degraded={countDegraded}
      />
      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">El rendimiento lo calcula el proveedor y puede no coincidir con el de la plataforma, que usa las lecturas de cada carga.</p>
    </PageContainer>
  )
}
