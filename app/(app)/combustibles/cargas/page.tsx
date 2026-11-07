import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules, fuelEquipmentTypes, fuelProducts, fuelSuppliers, fuelTaeLoadingPoints, fuelVehicles, users, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { SectionNav } from "@/components/ui/section-nav"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildCargaRowHrefs } from "@/lib/combustibles/cargas-hrefs"
import { canViewFuelPersonalData, getFieldLoadAttention, getFuelLogRows, getFuelLogTotal } from "@/lib/combustibles/fuel-log"
import { CARGAS_PAGE_SIZE, countActiveAdvancedFilters, parseCargasSearchParams } from "@/lib/combustibles/fuel-log-params"
import { canWithdrawOthersReviewRequest } from "@/lib/combustibles/fuel-log-review-request"
import type { FuelLogRow } from "@/lib/combustibles/fuel-log-shared"
import { FUEL_CARRY_PARAMS, toDateRange } from "@/lib/combustibles/period"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { cargasNavItems, fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { CargasAttentionStrip } from "./attention-strip"
import { CargasWorkbench } from "./cargas-workbench"
import type { CargasFilterOption } from "./cargas-filters"
import type { EnrichedRow } from "../bitacora/bitacora-table"
import type { TaeExportFilters } from "../tae/actions"

export const metadata: Metadata = { title: "Cargas" }

type SearchParams = Record<string, string | string[] | undefined>

const options = (rows: Array<{ id: string; name: string }>): CargasFilterOption[] => rows.map((row) => ({ value: row.id, label: row.name }))

/**
 * Cargas a equipos: una sola lista de todas las cargas (formulario en terreno,
 * app, histórico de sellos, planilla y factura) en la ventana del período de la
 * cabecera. Antes la repartían la bitácora y la lista de registros en terreno.
 * El alcance por faena y los datos personales los resuelve la consulta.
 */
export default async function CargasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.cargas) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const canViewPersonal = canViewFuelPersonalData(session)
  const { filters, sort, page } = parseCargasSearchParams(sp, { canViewPersonal, period: toDateRange(period), currentUserId: session.user.id })

  // Fuentes que fallaron y cayeron a su fallback: nunca se muestra un cero falso (CO-037).
  const degraded: string[] = []
  let tracked = 0
  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
    tracked++
    return promise.catch((error: unknown) => {
      logger.error(`[cargas] ${label} falló`, error)
      degraded.push(label)
      return fallback
    })
  }

  const scope = resolveWorksiteScope(session)
  const [worksitesList, suppliersList, productsList, equipmentTypesList, loadingPointsList, anomalyRulesList, anomalyAssigneesList, equipmentRow, total] = await Promise.all([
    track(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        columns: { id: true, name: true },
        orderBy: [worksites.name],
      }),
      [] as Array<{ id: string; name: string }>, "faenas",
    ),
    settle(db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), columns: { id: true, name: true }, orderBy: [fuelSuppliers.name] }), [] as Array<{ id: string; name: string }>, "cargas-proveedores"),
    settle(db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), columns: { id: true, name: true }, orderBy: [fuelProducts.name] }), [] as Array<{ id: string; name: string }>, "cargas-productos"),
    settle(db.query.fuelEquipmentTypes.findMany({ where: eq(fuelEquipmentTypes.isActive, true), columns: { id: true, name: true }, orderBy: [fuelEquipmentTypes.name] }), [] as Array<{ id: string; name: string }>, "cargas-tipos"),
    // Los puntos de carga pertenecen a una faena: sin acotar, el desplegable publicaba el mapa de instalaciones de todas.
    settle(
      db.query.fuelTaeLoadingPoints.findMany({ where: worksiteScopeSql(session, fuelTaeLoadingPoints.worksiteId), columns: { id: true, name: true }, orderBy: [fuelTaeLoadingPoints.name] }),
      [] as Array<{ id: string; name: string }>, "cargas-puntos",
    ),
    settle(db.query.fuelAnomalyRules.findMany({ where: eq(fuelAnomalyRules.isActive, true), columns: { code: true, name: true }, orderBy: [fuelAnomalyRules.name] }), [] as Array<{ code: string; name: string }>, "cargas-reglas"),
    // …y los responsables se derivan de casos con faena: sin acotar, el filtro enumeraba a quién investiga en faenas ajenas.
    settle(
      db.selectDistinct({ id: users.id, name: users.name }).from(fuelAnomalyCases)
        .innerJoin(users, eq(fuelAnomalyCases.assigneeId, users.id))
        .where(and(isNotNull(fuelAnomalyCases.assigneeId), worksiteScopeSql(session, fuelAnomalyCases.worksiteId)))
        .orderBy(users.name),
      [] as Array<{ id: string; name: string }>, "cargas-responsables",
    ),
    filters.vehicleId
      ? settle(
        db.query.fuelVehicles.findFirst({ where: and(eq(fuelVehicles.id, filters.vehicleId), worksiteScopeSql(session, fuelVehicles.worksiteId)), columns: { code: true, plate: true } }),
        undefined, "cargas-equipo",
      )
      : Promise.resolve(undefined),
    track(getFuelLogTotal(session, filters), 0, "total"),
  ])

  const pagination = resolvePagination({ pageParam: String(page), totalItems: total, pageSize: CARGAS_PAGE_SIZE })
  // Las filas y las cuatro señales de terreno van juntas, en una segunda tanda: sumar la consulta de las señales a la primera dejaba
  // diez consultas a la vez sobre un pool de diez. `null` si los filtros no pueden traer registros en terreno; con la consulta
  // caída la tira no se pinta y el aviso de datos degradados lo dice.
  const [rows, attention] = await Promise.all([
    track(getFuelLogRows(session, filters, { limit: CARGAS_PAGE_SIZE, offset: pagination.offset, sort }), [] as FuelLogRow[], "filas"),
    track(getFieldLoadAttention(session, filters), null, "señales de terreno"),
  ])

  const canViewAudit = can(session, "combustibles:view_audit")
  const canExport = can(session, "combustibles:export")
  const canTaeExport = can(session, "combustibles:tae_export")
  const canRegister = can(session, "combustibles:register_load")

  const context = (href: string) => withFuelContext(href, sp)
  const enriched: EnrichedRow[] = rows.map((row) => ({ ...row, hrefs: buildCargaRowHrefs(row, { canViewAudit, canViewPersonal, context }) }))

  const filtered = Boolean(
    filters.q || filters.worksiteId || filters.origins?.length || filters.stateSlug || filters.onlyPending || filters.vehicleId
    || countActiveAdvancedFilters(sp, canViewPersonal) > 0 || sp.punto,
  )

  // Quien sólo tiene `tae_export` (no `export`) exporta los registros en terreno con las columnas del formulario.
  const taeFilters: TaeExportFilters | undefined = !canExport && canTaeExport
    ? {
        q: filters.q,
        from: filters.from,
        to: filters.to,
        worksiteId: filters.worksiteId,
        loadingPointId: filters.loadingPointId,
        status: filters.stateSlug === "por-validar" ? "submitted" : filters.stateSlug === "con-observacion" ? "observed" : filters.stateSlug === "validada" ? "validated" : filters.stateSlug === "anulada" ? "voided" : undefined,
        seal: filters.sealIncomplete ? "missing" : undefined,
        evidence: filters.photosIncomplete ? "missing" : undefined,
        origins: filters.origins,
      }
    : undefined

  const hrefForPage = (target: number) => buildPaginationHref(FUEL_PATHS.cargas, { ...sp, page: undefined }, target, "pagina")

  return (
    <PageContainer>
      <CargasWorkbench
        period={period}
        rows={enriched}
        pagination={{ totalItems: pagination.totalItems, from: pagination.from, to: pagination.to }}
        exportFilters={filters}
        taeFilters={taeFilters}
        canExport={canExport}
        canRegister={canRegister}
        addDataOptions={fuelAddDataOptions(session)}
        lookups={{
          worksites: options(worksitesList),
          suppliers: options(suppliersList),
          products: options(productsList),
          equipmentTypes: options(equipmentTypesList),
          loadingPoints: options(loadingPointsList),
          anomalyRules: anomalyRulesList.map((rule) => ({ value: rule.code, label: rule.name })),
          anomalyAssignees: options(anomalyAssigneesList),
          equipmentLabel: equipmentRow ? [equipmentRow.code, equipmentRow.plate].filter(Boolean).join(" · ") : null,
        }}
        canViewPersonal={canViewPersonal}
        currentUserId={session.user.id}
        canWithdrawOthers={canWithdrawOthersReviewRequest(session)}
        filtered={filtered}
        before={
          <>
            <SectionNav items={cargasNavItems()} activeKey="cargas" ariaLabel="Vistas de cargas" carryParams={FUEL_CARRY_PARAMS} />
            <DegradedDataBanner degraded={degraded} total={tracked} />
            {attention && <CargasAttentionStrip attention={attention} searchParams={sp} periodInLabel={period.inLabel} />}
          </>
        }
        after={<ServerPagination pagination={pagination} hrefForPage={hrefForPage} className="mt-2" />}
      />
    </PageContainer>
  )
}
