import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { getIdleDailySeries, getIdleEquipmentMonths, getIdleFleetMonths, getIdleTopDays, hasTelemetryInScope, listIdleVehicles } from "@/lib/combustibles/control/queries/idle"
import { getLitersPerHourComparison } from "@/lib/combustibles/control/queries/idle-comparison"
import { summarizeIdleByEquipment } from "@/lib/combustibles/control/queries/idle-summary"
import { controlFiltersFromPeriod, exportParamsFromFilters } from "@/lib/combustibles/control/queries/period-filters"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { idleDailyChartData } from "@/lib/combustibles/equipment/idle-daily"
import { FUEL_PATHS, fuelEquipmentHref } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { resolvePagination } from "@/lib/pagination"
import { formatQty } from "@/lib/utils"
import { IdleDailyChartLazy, IdleLitersChartLazy, IdleMonthlyChartLazy } from "../../control/_charts/idle-charts-lazy"
import { SectionError, ViewSection } from "../../control/_charts/overview-section"
import { loadControlContext } from "../../control/_components/control-context"
import { ControlFilters } from "../../control/_components/control-filters"
import { EquipmentSelect } from "../../control/_components/equipment-select"
import { monthText, numberText, pctText } from "../../control/_components/format"
import { hrefInContext, searchWith } from "../../control/_components/page-links"
import { createSourceTracker } from "../../control/_components/track-sources"
import { ConsumoNav } from "../../consumo-nav"
import { Disclosure } from "../_components/disclosure"
import { LitersPerHourSection, TopIdleDaysTable } from "./comparison-sections"
import { EquipmentMonthTable } from "./equipment-month-table"
import { IdleExportButton } from "./idle-export-button"
import { IdleTopEquipmentTable } from "./top-equipment-table"

export const metadata: Metadata = { title: "Motor en vacío" }

const PAGE_SIZE = 50
const DESCRIPTION = "Horas con el motor encendido sin trabajar, según la telemetría de los equipos"

type SearchParams = Record<string, string | string[] | undefined>

export default async function MotorEnVacioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.consumo) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const filters = controlFiltersFromPeriod(period, sp)
  const ctx = await loadControlContext(session, { years: false })
  const canExport = can(session, "combustibles:export")
  const exportQuery = new URLSearchParams(exportParamsFromFilters(filters)).toString()
  const addTelemetry = fuelAddDataOptions(session).find((option) => option.kind === "telemetria")

  const { track, degraded, total } = createSourceTracker("combustibles/consumo/motor-en-vacio")
  const hasTelemetry = await track(hasTelemetryInScope(session, filters), true, "telemetría disponible")
  const breadcrumb = <FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Motor en vacío" }]} />
  const exportAction = canExport && hasTelemetry.data ? <IdleExportButton query={exportQuery} /> : null

  if (!hasTelemetry.failed && !hasTelemetry.data) {
    return (
      <PageContainer>
        <PageHeader title="Consumo y rendimiento" description={DESCRIPTION} breadcrumb={breadcrumb} actions={<FuelHeaderActions period={period} />} />
        <ConsumoNav activeKey="motor-en-vacio" />
        <EmptyState
          title="Aún no hay telemetría de equipos"
          description={addTelemetry?.allowed
            ? "El motor en vacío sale de la telemetría diaria de los equipos (horas de funcionamiento y en vacío), que viene de un archivo de VisionLink u otra fuente. Agrega el primer archivo para ver esta pantalla."
            : "El motor en vacío sale de la telemetría diaria de los equipos, que viene de un archivo de VisionLink u otra fuente. Pide a quien pueda agregar datos que cargue el primer archivo."}
          action={addTelemetry?.allowed ? <Button asChild><Link href={addTelemetry.href}><UploadSimple size={16} className="mr-1" />Agregar telemetría</Link></Button> : undefined}
        />
      </PageContainer>
    )
  }

  const [equipmentMonths, fleetMonths, vehicles, comparison, topDays] = await Promise.all([
    track(getIdleEquipmentMonths(session, filters), { rows: [], total: null }, "motor en vacío por equipo"),
    track(getIdleFleetMonths(session, filters), [], "motor en vacío por mes"),
    track(listIdleVehicles(session, filters), [], "equipos con telemetría"),
    track(getLitersPerHourComparison(session, filters), [], "litros por hora"),
    track(getIdleTopDays(session, filters, 20), [], "días con más motor en vacío"),
  ])
  const selectedVehicle = vehicles.data.find((vehicle) => vehicle.id === filters.equipment) ?? vehicles.data[0]
  const daily = selectedVehicle ? await track(getIdleDailySeries(session, filters, selectedVehicle.id), [], "serie diaria") : null

  const pagination = resolvePagination({ pageParam: String(filters.page), totalItems: equipmentMonths.data.rows.length, pageSize: PAGE_SIZE })
  const pageRows = equipmentMonths.data.rows.slice(pagination.offset, pagination.offset + PAGE_SIZE)
  const hrefForPage = (page: number) => searchWith(sp, { pagina: page > 1 ? String(page) : null })
  const fleet = equipmentMonths.data.total
  const topEquipment = summarizeIdleByEquipment(equipmentMonths.data.rows)
  const equipmentHref = (vehicleId: string) => hrefInContext(fuelEquipmentHref(vehicleId), period)

  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        description={DESCRIPTION}
        breadcrumb={breadcrumb}
        actions={<FuelHeaderActions period={period}>{exportAction}</FuelHeaderActions>}
      />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ConsumoNav activeKey="motor-en-vacio" />
      <ControlFilters worksites={ctx.worksites} mandantes={ctx.mandantes} extraKeys={["equipo"]} />

      {fleet && fleet.idlePct !== null ? (
        <p className="mb-6 max-w-[78ch] text-base text-[var(--color-text)]">
          En {period.inLabel}, <strong className="font-semibold tabular-nums">{pctText(fleet.idlePct)}</strong> de las{" "}
          <strong className="font-semibold tabular-nums">{numberText(fleet.operatingHours, 0)} horas</strong> de motor fueron en vacío:{" "}
          <strong className="font-semibold tabular-nums">{numberText(fleet.idleHours, 0)} h</strong>
          {fleet.litersIdle !== null ? <> y unos <strong className="font-semibold tabular-nums">{formatQty(fleet.litersIdle, undefined, { maximumFractionDigits: 0 })} L</strong></> : null}.
        </p>
      ) : (
        <p className="mb-6 max-w-[78ch] text-base text-[var(--color-text-muted)]">No hay horas de motor en este período con estos filtros. Prueba con otro período o quita la faena.</p>
      )}

      <ViewSection id="mensual" title="Horas de motor por mes" question="¿Cuánto del tiempo y del combustible se va en vacío, mes a mes?">
        {fleetMonths.failed ? <SectionError what="la evolución mensual" /> : (
          <div className="grid gap-8 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Horas trabajando y en vacío</h3>
              <IdleMonthlyChartLazy data={fleetMonths.data.map((row) => ({ label: monthText(row.month), workingHours: row.workingHours, idleHours: row.idleHours, idlePct: row.idlePct }))} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Litros en vacío</h3>
              <IdleLitersChartLazy data={fleetMonths.data.map((row) => ({ label: monthText(row.month), litersIdle: row.litersIdle, idleLitersPct: row.idleLitersPct }))} />
            </div>
          </div>
        )}
      </ViewSection>

      <ViewSection id="equipos" title="Equipos con más tiempo en vacío" question="¿Qué equipos pasan más tiempo con el motor encendido sin trabajar? El código abre la ficha del equipo.">
        {equipmentMonths.failed ? <SectionError what="la tabla por equipo" /> : <IdleTopEquipmentTable rows={topEquipment} equipmentHref={equipmentHref} />}
      </ViewSection>

      <div className="mb-10 grid gap-3">
        <Disclosure
          title="Por equipo y mes"
          description="Todas las cifras: horas, porcentajes diarios, horas por día y litros de cada equipo en cada mes."
          defaultOpen={Boolean(sp.pagina)}
        >
          {equipmentMonths.failed ? <SectionError what="la tabla por equipo y mes" /> : <EquipmentMonthTable rows={pageRows} total={fleet} pagination={pagination} hrefForPage={hrefForPage} />}
        </Disclosure>
        <Disclosure
          title="Día a día de un equipo"
          description="Horas de motor y porcentaje en vacío por día del equipo que elijas."
          actions={vehicles.failed || vehicles.data.length === 0 ? null : <EquipmentSelect options={vehicles.data} value={selectedVehicle?.id ?? ""} ariaLabel="Equipo del gráfico diario" />}
        >
          {vehicles.failed || daily?.failed ? <SectionError what="la serie diaria" /> : <IdleDailyChartLazy data={idleDailyChartData(daily?.data ?? [])} />}
        </Disclosure>
        <Disclosure title="Telemetría contra cargas" description="Un punto por equipo y mes: los litros por hora que mide la telemetría contra los que salen de las cargas. Los que se alejan de la diagonal llevan nombre.">
          {comparison.failed ? <SectionError what="la comparación de litros por hora" /> : <LitersPerHourSection rows={comparison.data} equipmentHref={equipmentHref} cargasHref={hrefInContext(FUEL_PATHS.cargas, period)} />}
        </Disclosure>
        <Disclosure title="Los 20 días con más vacío" description="Sólo días con al menos 1 hora de motor: un día de minutos daría 100 % sin significar nada.">
          {topDays.failed ? <SectionError what="los días con más motor en vacío" /> : <TopIdleDaysTable rows={topDays.data} />}
        </Disclosure>
      </div>
    </PageContainer>
  )
}
