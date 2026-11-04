import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Drop, Receipt, Scales, Truck } from "@phosphor-icons/react/dist/ssr"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProducts, fuelStorageLocations, fuelSuppliers, fuelVehicles } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { getFuelCycleComparison, getFuelStorageBalances, getFuelStorageDailyFlows, listFuelCycleMovements, type CycleStage } from "@/lib/combustibles/fuel-cycle"
import { toChileInstantRange, toDateRange } from "@/lib/combustibles/period/adapters"
import { fuelPeriodSearchParams } from "@/lib/combustibles/period/parse"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, cuadraturaNavItems } from "@/lib/combustibles/section-nav"
import { buildTankLevelView } from "@/lib/combustibles/tank-level"
import { ControlFilters } from "../../control/_components/control-filters"
import { loadCuadraturaContext } from "../_components/context"
import { firstParam, hrefWith, periodContext } from "../_components/params"
import { ControlSection, SectionError } from "../_components/section"
import { createSourceTracker } from "../_components/track"
import { CycleWorkbench } from "./cycle-workbench"
import { MovementsTable, StorageLevelBars, StorageLevelTrend, StorageLevels, cycleAnswer, severityBadge, stageAmount, type CycleMovementRow } from "./estanques-sections"
import { UrlSelect } from "../_components/url-select"
import { litersText } from "../_components/format"
import { formatQty } from "@/lib/utils"

export const metadata: Metadata = { title: "Estanques" }

type SearchParams = Record<string, string | string[] | undefined>

const PATH = FUEL_PATHS.cuadraturaEstanques
const MOVEMENTS_ANCHOR = "#movimientos"

const CYCLE_FALLBACK = {
  received: null, registered: null, delivered: null,
  differences: { receivedVsRegistered: { status: "unavailable" as const, absolute: null, percent: null }, receivedVsDelivered: { status: "unavailable" as const, absolute: null, percent: null } },
}

export default async function CuadraturaEstanquesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", PATH) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const worksiteId = firstParam(sp, "faena")
  const productId = firstParam(sp, "producto")
  const stageParam = firstParam(sp, "etapa")
  const stage: CycleStage | undefined = stageParam === "received" || stageParam === "delivered" ? stageParam : undefined
  const ctxParams = periodContext(period, worksiteId)
  const canCreate = can(session, "combustibles:create")
  const canCreateTank = can(session, "admin:fleet_catalog")
  const canExport = can(session, "combustibles:export")

  // Los días del período para las cifras (la consulta los compara en hora de Chile) y sus instantes
  // —inicio incluido, fin excluido— para la lista de movimientos, cuyo `occurredAt` es un `timestamptz`.
  const { from, to } = toDateRange(period)
  const instants = toChileInstantRange(period)
  const scope = { worksiteId, productId }

  const ctx = await loadCuadraturaContext(session)
  const { track, degraded, total } = createSourceTracker("cuadratura-estanques")
  // El nivel en el tiempo parte de los estanques que ya trae el balance (mismos filtros y alcance) y de su
  // nivel «Al inicio»: es la misma definición que la tabla, así que la curva termina en su «Nivel».
  const balancesPromise = getFuelStorageBalances(session, { ...scope, from, to })
  const [comparison, balances, levelFlows, movements, products, suppliers, locations, vehicles] = await Promise.all([
    track(getFuelCycleComparison(session, { ...scope, from, to }), CYCLE_FALLBACK, "etapas del ciclo"),
    track(balancesPromise, [], "nivel por estanque"),
    track(balancesPromise.then((rows) => getFuelStorageDailyFlows(session, rows, { from, to })), [], "nivel en el tiempo"),
    track(listFuelCycleMovements(session, { ...scope, ...instants, stage }), { rows: [], total: 0 }, "movimientos"),
    settle(db.select({ id: fuelProducts.id, name: fuelProducts.name }).from(fuelProducts).where(eq(fuelProducts.isActive, true)).orderBy(asc(fuelProducts.name)), [], "cuadratura-products"),
    canCreate ? settle(db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name }).from(fuelSuppliers).where(eq(fuelSuppliers.isActive, true)).orderBy(asc(fuelSuppliers.name)), [], "cuadratura-suppliers") : Promise.resolve([]),
    canCreate
      ? settle(db.select({ id: fuelStorageLocations.id, name: fuelStorageLocations.name, worksiteId: fuelStorageLocations.worksiteId, productId: fuelStorageLocations.productId }).from(fuelStorageLocations)
        .where(and(eq(fuelStorageLocations.isActive, true), worksiteScopeSql(session, fuelStorageLocations.worksiteId))).orderBy(asc(fuelStorageLocations.name)), [], "cuadratura-locations")
      : Promise.resolve([]),
    canCreate
      ? settle(db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, code: fuelVehicles.code, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles)
        .where(and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId))).orderBy(asc(fuelVehicles.plate)), [], "cuadratura-vehicles")
      : Promise.resolve([]),
  ])

  const data = comparison.data
  const phrase = `en ${period.inLabel}`
  const severity = severityBadge(data.differences.receivedVsDelivered)
  const difference = data.differences.receivedVsDelivered
  const receivedHref = `${hrefWith(PATH, sp, { etapa: "received", pagina: null })}${MOVEMENTS_ANCHOR}`
  const deliveredHref = `${hrefWith(PATH, sp, { etapa: "delivered", pagina: null })}${MOVEMENTS_ANCHOR}`
  const allHref = `${hrefWith(PATH, sp, { etapa: null, pagina: null })}${MOVEMENTS_ANCHOR}`
  const invoicedHref = withFuelContext(`${FUEL_PATHS.cargas}?como=factura`, ctxParams)
  const movementRows: CycleMovementRow[] = movements.data.rows
  const levelView = buildTankLevelView(balances.data, levelFlows.data, { from, to })
  const previousPeriodHref = period.prev
    ? hrefWith(PATH, sp, { periodo: null, desde: null, hasta: null, pagina: null, ...fuelPeriodSearchParams(period.prev) })
    : null

  return (
    <PageContainer>
      <PageHeader
        title="Estanques"
        description="Lo que recibió cada estanque contra lo que entregó"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Estanques" }]} />}
        actions={
          <FuelHeaderActions period={period}>
            <CycleWorkbench canCreate={canCreate} worksites={ctx.worksites} products={products} suppliers={suppliers} locations={locations} vehicles={vehicles} />
          </FuelHeaderActions>
        }
      />
      <SectionNav items={cuadraturaNavItems(session)} activeKey="estanques" ariaLabel="Vistas de cuadratura" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ControlFilters worksites={ctx.worksites} extraKeys={["producto", "etapa"]}>
        <UrlSelect param="producto" options={products.map((item) => ({ id: item.id, label: item.name }))} value={productId ?? ""} ariaLabel="Producto" allLabel="Todos los productos" className="w-56" searchable={false} />
      </ControlFilters>

      {comparison.failed ? (
        <SectionError what="las etapas del ciclo" />
      ) : (
        <div className="space-y-8">
          <p className="max-w-3xl text-base text-[var(--color-text)]" data-testid="estanques-answer">{cycleAnswer(data, phrase)}</p>

          {/* Cuatro tiles (regla A1), cada uno lleva a su subconjunto: las tres etapas físicas y la diferencia que importa, recibido − entregado. */}
          <section aria-label="Etapas del ciclo y diferencia" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={<Drop size={16} aria-hidden />} label="Recibido en estanques" value={stageAmount(data.received)} href={receivedHref}
              detail={data.received ? `${data.received.records} ${data.received.records === 1 ? "recepción" : "recepciones"}` : "Sin recepciones en el período"}
              empty={data.received ? undefined : { message: "Sin recepciones", actionLabel: canCreate ? "Registrar una recepción" : "Ver movimientos" }}
            />
            <KpiCard
              icon={<Receipt size={16} aria-hidden />} label="Registrado en facturas" value={stageAmount(data.registered)} href={invoicedHref}
              detail={data.registered ? `${data.registered.records} ${data.registered.records === 1 ? "carga facturada" : "cargas facturadas"}` : "Sin cargas facturadas"}
              empty={data.registered ? undefined : { message: "Sin cargas facturadas", actionLabel: "Ver las cargas" }}
            />
            <KpiCard
              icon={<Truck size={16} aria-hidden />} label="Entregado a equipos" value={stageAmount(data.delivered)} href={deliveredHref}
              detail={data.delivered ? `${data.delivered.records} ${data.delivered.records === 1 ? "entrega" : "entregas"}` : "Sin entregas en el período"}
              empty={data.delivered ? undefined : { message: "Sin entregas", actionLabel: "Ver movimientos" }}
            />
            <KpiCard
              icon={<Scales size={16} aria-hidden />} label="Diferencia recibido − entregado" href={allHref}
              value={difference.status === "available" ? litersText(difference.absolute) : "—"}
              detail={difference.status === "available" ? `${difference.percent === null ? "Base cero" : `${formatQty(Math.abs(difference.percent), undefined, { maximumFractionDigits: 1 })} %`} · ${severity.label}` : "Falta una de las dos etapas para comparar"}
              tone={severity.variant === "danger" ? "danger" : severity.variant === "warning" ? "signal" : "neutral"}
              empty={difference.status === "available" ? undefined : { message: "Sin comparar", actionLabel: "Ver movimientos" }}
            />
          </section>

          <ControlSection id="nivel" title="Nivel por estanque" question="¿Cuánto combustible quedó en cada estanque contra su capacidad?">
            {balances.failed ? <SectionError what="el nivel por estanque" /> : (
              <div className="space-y-4">
                <StorageLevelBars balances={balances.data} canEditTanks={canCreateTank} />
                {balances.data.length === 0 ? null : levelFlows.failed ? <SectionError what="el nivel en el tiempo" /> : (
                  <StorageLevelTrend
                    view={levelView}
                    periodPhrase={phrase}
                    previousPeriodHref={previousPeriodHref}
                    canCreate={canCreate}
                    excel={canExport ? { permission: "combustibles:export" } : undefined}
                  />
                )}
                <StorageLevels balances={balances.data} canCreateTank={canCreateTank} />
              </div>
            )}
          </ControlSection>

          <div id="movimientos" className="scroll-mt-24">
            <ControlSection
              id="movimientos-lista"
              title="Movimientos"
              question="Recepciones, traspasos y entregas, con el documento que los respalda."
              actions={
                <SegmentedControl
                  variant="pills"
                  ariaLabel="Filtrar movimientos por etapa"
                  items={[
                    { key: "todos", label: "Todos", active: !stage, href: allHref },
                    { key: "received", label: "Recepciones", active: stage === "received", href: receivedHref },
                    { key: "delivered", label: "Entregas", active: stage === "delivered", href: deliveredHref },
                  ]}
                />
              }
            >
              {movements.failed ? (
                <SectionError what="los movimientos" />
              ) : movementRows.length === 0 ? (
                <EmptyState
                  compact
                  title="No hay movimientos de estanque en este período"
                  description="Aquí se ven las recepciones, los traspasos y las entregas desde un estanque. Las entregas de los formularios en terreno se cuentan en los totales, pero se ven en Cargas."
                  action={canCreate ? undefined : <Button asChild variant="secondary" size="sm"><Link href={withFuelContext(`${FUEL_PATHS.cargas}?como=qr,app,historico`, ctxParams)}>Ver las cargas en terreno</Link></Button>}
                />
              ) : (
                <>
                  <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                    Los últimos {movementRows.length}{movements.data.total > movementRows.length ? ` de ${movements.data.total}` : ""} {stage === "received" ? "recibidos" : stage === "delivered" ? "entregados" : "movimientos"}. Las entregas de los formularios en terreno se cuentan en los totales y se ven en{" "}
                    <Link className="font-medium text-[var(--color-primary-ink)] underline underline-offset-4" href={withFuelContext(`${FUEL_PATHS.cargas}?como=qr,app,historico`, ctxParams)}>Cargas</Link>.
                  </p>
                  <MovementsTable rows={movementRows} />
                </>
              )}
            </ControlSection>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
