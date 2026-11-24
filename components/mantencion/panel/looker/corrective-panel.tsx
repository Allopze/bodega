import { ChartFrame } from "@/components/charts/chart-frame"
import { HoursRecordsComboChartLazy } from "@/components/charts/hours-records-combo-chart-lazy"
import { DashboardPanel, PanelBlock } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCaption, TableCell, TableCellNum, TableHead, TableHeader, TableRow, TableRoot } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import { resolvePagination } from "@/lib/pagination"
import { conductorAction, workAction } from "@/lib/services/mantencion/looker/filters"
import type { CorrectivePage, CorrectiveSummary } from "@/lib/services/mantencion/looker/types"
import { formatDate, formatQty } from "@/lib/utils"
import { CrossFilterBars } from "./cross-filter-bars"
import { CrossFilterRow } from "./cross-filter-row"
import { FilterToggle } from "./filter-toggle"
import { WorkPhoto } from "./work-photo"

const SOURCE_LABEL = { ot: "OT", historial: "Formulario", registro: "Registro" } as const

/**
 * Columna Correctivo: trabajos correctivos paginados, conductores y dos gráficos.
 * El clic en una OT emite `x_ot`; la tabla no se filtra a sí misma (el cargador ignora esa
 * dimensión), pero sí aplica el conductor elegido. El clic en un conductor emite
 * `x_conductor`; la tabla de conductores no se filtra a sí misma.
 */
export function CorrectivePanel({
  page,
  drivers,
  chart,
  unit,
  hrefForPage,
  selectedWorkId,
  selectedDriverKey,
  selectedEquipmentId,
}: {
  page: CorrectivePage
  drivers: CorrectiveSummary
  chart: CorrectiveSummary
  unit: "km" | "h"
  hrefForPage: (page: number) => string
  selectedWorkId: string | null
  selectedDriverKey: string | null
  selectedEquipmentId: string | null
}) {
  const pagination = resolvePagination({ pageParam: String(page.page), totalItems: page.total, pageSize: page.pageSize })
  const readingLabel = unit === "km" ? "Odómetro" : "Horómetro"

  return (
    <div className="flex flex-col gap-4">
      <DashboardPanel cols="single">
        <PanelBlock padding="none">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-eyebrow text-[var(--color-text)]">Órdenes de trabajo y correctivas</h3>
              <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(page.total, "trabajo", "trabajos")}</p>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              OT que ya entraron a taller y correctivas desde el corte. La fecha es el ingreso a taller.
            </p>
          </div>
          {page.rows.length === 0 ? (
            <EmptyState
              compact
              title="Sin trabajos correctivos en el período"
              description="Prueba con otro período, otra faena u otro equipo. Una OT entra cuando registra el ingreso a taller."
            />
          ) : (
            <>
              <TableRoot framed={false}>
                <Table className="min-w-max text-xs [&_td]:px-1.5 [&_th]:px-1.5">
                  <TableCaption className="sr-only">Órdenes de trabajo y correctivas del período</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingreso / OT</TableHead>
                      <TableHead>Equipo</TableHead>
                      <TableHead className="text-right">{readingLabel}</TableHead>
                      <TableHead>Trabajo realizado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.rows.map((row) => {
                      const action = workAction(row.id, selectedWorkId === row.id)
                      const label = row.code || row.plate || "Equipo"
                      return (
                        <CrossFilterRow key={row.id} action={action} active={selectedWorkId === row.id}>
                          <TableCell>
                            <span className="block font-mono text-xs">{formatDate(row.date)}</span>
                            <span className="block text-2xs text-[var(--color-text-subtle)]">{SOURCE_LABEL[row.source]}</span>
                            <FilterToggle action={action} className="font-mono text-xs font-semibold">
                              {row.reference || "Sin folio"}
                            </FilterToggle>
                          </TableCell>
                          <TableCell>
                            <span className="block font-mono text-xs font-semibold">{row.code || "—"}</span>
                            {row.plate && row.plate !== row.code && <span className="block text-2xs text-[var(--color-text-muted)]">{row.plate}</span>}
                            {row.typeName && <span className="block text-2xs text-[var(--color-text-subtle)]">{row.typeName}</span>}
                            <span className="mt-1 block">
                              {row.photoUrl ? (
                                <a
                                  href={row.photoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="text-2xs font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline"
                                >
                                  Ver foto
                                </a>
                              ) : <WorkPhoto photoId={row.photoId} alt={`${label} del ${formatDate(row.date)}`} compact />}
                            </span>
                          </TableCell>
                          <TableCellNum>
                            {row.reading != null ? `${formatQty(row.reading)} ${unit}` : row.readingText ?? "—"}
                          </TableCellNum>
                          <TableCell>
                            <span className="line-clamp-2 max-w-40 text-xs" title={row.workPerformed}>{row.workPerformed || "—"}</span>
                          </TableCell>
                        </CrossFilterRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableRoot>
              <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
            </>
          )}
        </PanelBlock>
      </DashboardPanel>

      <DashboardPanel cols="single">
        <PanelBlock padding="none">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-eyebrow text-[var(--color-text)]">Conductores</h3>
              <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(drivers.drivers.length, "conductor", "conductores")}</p>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Horas prorrateadas entre los conductores de cada registro. Los nombres del histórico son texto libre.
            </p>
          </div>
          {drivers.drivers.length === 0 ? (
            <EmptyState compact title="Sin conductores registrados" description="Los registros del período no declaran conductores." />
          ) : (
            <TableRoot framed={false}>
              <Table className="text-xs">
                <TableCaption className="sr-only">Conductores del período</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conductor</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Registros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.drivers.map((driver) => {
                    const action = conductorAction(driver.label, selectedDriverKey === driver.key)
                    return (
                      <CrossFilterRow key={driver.key} action={action} active={selectedDriverKey === driver.key}>
                        <TableCell>
                          <FilterToggle action={action} className="text-xs font-medium">{driver.label}</FilterToggle>
                        </TableCell>
                        <TableCellNum>{formatQty(driver.hours, undefined, { maximumFractionDigits: 1 })} h</TableCellNum>
                        <TableCellNum>{driver.records}</TableCellNum>
                      </CrossFilterRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          )}
        </PanelBlock>

        <PanelBlock padding="none">
          <ChartFrame
            title="Horas trabajadas por conductor"
            description="Las 10 personas con más horas del período."
          >
            <CrossFilterBars
              ariaLabel="Horas trabajadas por conductor"
              items={drivers.drivers.slice(0, 10).map((driver) => ({
                key: driver.key,
                label: driver.label,
                value: driver.hours,
                detail: `${driver.records} registros`,
              }))}
              unit=" h"
              digits={1}
              mode="rank"
              selectedKey={selectedDriverKey}
              actionFor={(item) => conductorAction(item.label, item.key === selectedDriverKey)}
              emptyMessage="Sin horas de conductor en el período."
            />
          </ChartFrame>
        </PanelBlock>

        <PanelBlock padding="none">
          <ChartFrame
            title="Horas y registros por equipo"
            description="Barras: horas trabajadas. Línea: número de registros. Ejes separados porque son escalas distintas."
          >
            {chart.series.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Sin trabajos con horas en el período.</p>
            ) : (
              <HoursRecordsComboChartLazy
                data={chart.series.map((row) => ({ key: row.vehicleId, label: row.label, hours: row.hours, records: row.records }))}
                ariaLabel="Horas trabajadas y número de registros por equipo"
                selectedKey={selectedEquipmentId}
              />
            )}
          </ChartFrame>
        </PanelBlock>
      </DashboardPanel>
    </div>
  )
}
