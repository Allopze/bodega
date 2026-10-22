import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requirePermission } from "@/lib/auth/can"
import { controlFiltersToParams, parseControlFilters } from "@/lib/combustibles/control/filters"
import { getIdleDailySeries, getIdleEquipmentMonths, getIdleFleetMonths, getIdleTopDays, hasTelemetryInScope, listIdleVehicles } from "@/lib/combustibles/control/queries/idle"
import { getLitersPerHourComparison } from "@/lib/combustibles/control/queries/idle-comparison"
import { resolvePagination } from "@/lib/pagination"
import { IdleDailyChartLazy, IdleLitersChartLazy, IdleMonthlyChartLazy } from "../_charts/idle-charts-lazy"
import { ControlFilters } from "../_components/control-filters"
import { loadControlContext } from "../_components/control-context"
import { ControlNav } from "../_components/control-nav"
import { ControlSection, SectionError } from "../sellos/section"
import { EquipmentSelect } from "../sellos/equipment-select"
import { monthText, numberText, pctText } from "../sellos/format"
import { createSourceTracker } from "../sellos/track"
import { LitersPerHourTable, TopIdleDaysTable } from "./comparison-sections"
import { EquipmentMonthTable } from "./equipment-month-table"
import { IdleExportButton } from "./idle-export-button"

export const metadata: Metadata = { title: "Ralentí" }

const PAGE_SIZE = 50
const PATH = "/combustibles/control/ralenti"
const BREADCRUMB = [{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Ralentí" }]

export default async function IdlePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("combustibles:view", PATH) } catch { redirect("/forbidden") }

  const filters = parseControlFilters(await searchParams)
  const ctx = await loadControlContext(session)
  const canImport = can(session, "combustibles:import")
  const canExport = can(session, "combustibles:export")
  const exportQuery = controlFiltersToParams({ ...filters, page: 1 }).toString()

  const { track, degraded, total } = createSourceTracker("control-ralenti")
  const hasTelemetry = await track(hasTelemetryInScope(session, filters), true, "telemetría disponible")
  const header = (
    <PageHeader
      title="Ralentí"
      description="Tiempo y combustible que los equipos gastan con el motor en vacío"
      breadcrumb={BREADCRUMB}
      actions={canExport && hasTelemetry.data ? <IdleExportButton query={exportQuery} /> : null}
    />
  )

  if (!hasTelemetry.failed && !hasTelemetry.data) {
    return (
      <PageContainer>
        {header}
        <ControlNav items={ctx.navItems} />
        <EmptyState
          title="Aún no hay telemetría de equipos"
          description={canImport
            ? "El ralentí sale de la telemetría diaria de los equipos (horas de funcionamiento y en vacío), que se importa desde un archivo de VisionLink u otra fuente. Importa el primer archivo para ver esta vista."
            : "El ralentí sale de la telemetría diaria de los equipos, que se importa desde un archivo de VisionLink u otra fuente. Pide a quien tenga permiso de importación que cargue el primer archivo."}
          action={canImport ? <Button asChild><Link href="/combustibles/control/importar"><UploadSimple size={16} className="mr-1" />Importar telemetría</Link></Button> : undefined}
        />
      </PageContainer>
    )
  }

  const [equipmentMonths, fleetMonths, vehicles, comparison, topDays] = await Promise.all([
    track(getIdleEquipmentMonths(session, filters), { rows: [], total: null }, "ralentí por equipo"),
    track(getIdleFleetMonths(session, filters), [], "ralentí por mes"),
    track(listIdleVehicles(session, filters), [], "equipos con telemetría"),
    track(getLitersPerHourComparison(session, filters), [], "litros por hora"),
    track(getIdleTopDays(session, filters, 20), [], "días con más ralentí"),
  ])
  const selectedVehicle = vehicles.data.find((vehicle) => vehicle.id === filters.equipment) ?? vehicles.data[0]
  const daily = selectedVehicle ? await track(getIdleDailySeries(session, filters, selectedVehicle.id), [], "serie diaria") : null

  const pagination = resolvePagination({ pageParam: String(filters.page), totalItems: equipmentMonths.data.rows.length, pageSize: PAGE_SIZE })
  const pageRows = equipmentMonths.data.rows.slice(pagination.offset, pagination.offset + PAGE_SIZE)
  const hrefForPage = (page: number) => `${PATH}?${controlFiltersToParams({ ...filters, page }).toString()}`
  const fleet = equipmentMonths.data.total

  return (
    <PageContainer>
      {header}
      <ControlNav items={ctx.navItems} />
      <ControlFilters years={ctx.years} defaultYear={ctx.defaultYear} worksites={ctx.worksites} mandantes={ctx.mandantes} extraKeys={["equipo"]} />
      <DegradedDataBanner degraded={degraded} total={total()} />
      {fleet && fleet.idlePct !== null ? (
        <p className="mb-2 mt-3 text-sm text-[var(--color-text-muted)]">
          En el período, <strong className="font-semibold text-[var(--color-text)]">{pctText(fleet.idlePct)}</strong> de las {numberText(fleet.operatingHours)} horas de funcionamiento fueron en vacío ({numberText(fleet.idleHours)} h).
        </p>
      ) : null}

      <ControlSection id="mensual" title="Evolución por mes" question="¿Cuánto del tiempo y del combustible se va en vacío, mes a mes?">
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
      </ControlSection>

      <ControlSection id="equipos" title="Por equipo y mes" question="¿Qué equipos pasan más tiempo en vacío?">
        {equipmentMonths.failed ? <SectionError what="la tabla por equipo" /> : <EquipmentMonthTable rows={pageRows} total={fleet} pagination={pagination} hrefForPage={hrefForPage} />}
      </ControlSection>

      <ControlSection
        id="diario"
        title="Día a día de un equipo"
        question="¿Cómo se reparte el ralentí en los días de un equipo?"
        actions={vehicles.failed || vehicles.data.length === 0 ? null : <EquipmentSelect options={vehicles.data} value={selectedVehicle?.id ?? ""} ariaLabel="Equipo del gráfico diario" />}
      >
        {vehicles.failed || daily?.failed ? <SectionError what="la serie diaria" /> : <IdleDailyChartLazy data={(daily?.data ?? []).map((point) => ({ label: `${point.day.slice(8, 10)}/${point.day.slice(5, 7)}`, operatingHours: point.operatingHours, idlePct: point.idlePct }))} />}
      </ControlSection>

      <ControlSection id="lph" title="Telemetría frente a cargas" question="¿El L/h que mide la telemetría coincide con el que sale de las cargas?">
        {comparison.failed ? <SectionError what="la comparación de L/h" /> : <LitersPerHourTable rows={comparison.data} />}
      </ControlSection>

      <ControlSection id="dias" title="Días con más ralentí" question="¿Qué 20 días tuvieron el mayor porcentaje en vacío?">
        {topDays.failed ? <SectionError what="los días con más ralentí" /> : <TopIdleDaysTable rows={topDays.data} />}
      </ControlSection>
    </PageContainer>
  )
}
