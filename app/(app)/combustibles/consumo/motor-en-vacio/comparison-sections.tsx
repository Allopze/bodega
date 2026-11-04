import Link from "next/link"
import type { ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartSection } from "@/components/charts/chart-section"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PERFORMANCE_UNIT_TITLES } from "@/lib/combustibles/control/contracts"
import { LPH_BAND_PCT, buildLphComparison, describeLphComparison, type LphComparisonView } from "@/lib/combustibles/control/calc/lph-comparison"
import type { LitersPerHourComparisonRow } from "@/lib/combustibles/control/queries/idle-comparison"
import type { IdleTopDay } from "@/lib/combustibles/control/queries/idle"
import { countOf, formatDate } from "@/lib/utils"
import { LphScatterChartLazy } from "../../control/_charts/idle-charts-lazy"
import { monthText, numberText, pctText } from "../../control/_components/format"

const lph = (value: number | null) => (value === null ? "—" : `${numberText(value, 2)} L/h`)

/** V-08: L/h que mide la telemetría frente al L/h que sale de las cargas del mismo equipo y mes. */
export function LitersPerHourTable({ rows }: { rows: LitersPerHourComparisonRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay telemetría en este período para comparar con las cargas.</p>
  }
  return (
    <TableRoot stickyHeader aria-label="L/h de telemetría frente a L/h de cargas">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Equipo</TableHead>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right" title={`Telemetría: ${PERFORMANCE_UNIT_TITLES.liters_per_hour}`}>L/h telemetría</TableHead>
            <TableHead className="text-right" title="Promedio del rendimiento L/h de las cargas del mes que entran a estadística">L/h desde cargas</TableHead>
            <TableHead className="text-right" title="(telemetría − cargas) ÷ cargas">Diferencia %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.vehicleId}|${row.month}`}>
              <TableCell className="whitespace-nowrap font-medium">{row.equipment}</TableCell>
              <TableCell className="whitespace-nowrap">{monthText(row.month)}</TableCell>
              <TableCellNum>{lph(row.telemetryLph)}</TableCellNum>
              {row.loadsLph === null ? (
                <TableCell colSpan={2} className="text-right text-[var(--color-text-muted)]">Sin cargas en el mes</TableCell>
              ) : (
                <>
                  <TableCellNum>{lph(row.loadsLph)}<span className="ml-1.5 text-xs text-[var(--color-text-muted)]">({row.loadCount})</span></TableCellNum>
                  <TableCellNum>{pctText(row.differencePct)}</TableCellNum>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}

/** Menos equipos que esto y el gráfico no dice nada de la flota: sólo de esos equipos. */
const FEW_EQUIPMENT = 6
/** Cuántos equipos fuera de la banda se listan con su enlace; la tabla de abajo trae todos. */
const OUTSIDE_LIST_LIMIT = 10

function comparisonNotes(view: LphComparisonView): string[] {
  const notes: string[] = []
  if (view.equipmentCount < FEW_EQUIPMENT) {
    notes.push(`${view.equipmentCount === 1 ? "Es un solo equipo" : `Son sólo ${view.equipmentCount} equipos`}: léelo como una señal por equipo, no como una cifra de la flota.`)
  }
  if (view.noLoads > 0) {
    notes.push(view.noLoads === 1
      ? "1 equipo-mes con telemetría no tiene cargas con L/h para comparar, así que no aparece en el gráfico; está en la tabla."
      : `${countOf(view.noLoads, "equipo-mes", "equipos-mes")} con telemetría no tienen cargas con L/h para comparar, así que no aparecen en el gráfico; están en la tabla.`)
  }
  if (view.noTelemetry > 0) {
    notes.push(view.noTelemetry === 1
      ? "1 equipo-mes tiene telemetría sin litros informados, así que no hay L/h que comparar."
      : `${countOf(view.noTelemetry, "equipo-mes", "equipos-mes")} tienen telemetría sin litros informados, así que no hay L/h que comparar.`)
  }
  return notes
}

/**
 * CHART-021: telemetría contra cargas. El gráfico responde «¿qué equipos se salen de
 * la diagonal?» y la tabla de abajo, que no se retira, trae todos los equipos-mes,
 * también los que no tienen un lado para comparar. Los equipos fuera de la banda se
 * listan con un enlace a su ficha *fuera* del gráfico: un enlace dentro de una imagen
 * no es accesible (axe `nested-interactive`).
 */
export function LitersPerHourSection({ rows, equipmentHref, cargasHref, excel }: { rows: LitersPerHourComparisonRow[]; equipmentHref?: (vehicleId: string) => string; cargasHref?: string; excel?: ChartDataExcel }) {
  if (rows.length === 0) return <LitersPerHourTable rows={rows} />
  const view = buildLphComparison(rows)
  const summary = describeLphComparison(view)
  const notes = comparisonNotes(view)
  const listed = view.outside.slice(0, OUTSIDE_LIST_LIMIT)
  return (
    <div className="grid gap-6">
      <ChartSection
        bare
        headingLevel={3}
        title="Telemetría contra cargas, por equipo y mes"
        summary={summary ?? undefined}
        data={summary ? {
          caption: "Equipos y meses con telemetría y cargas, del que más se aleja al que menos",
          headers: ["Equipo", "Mes", "L/h telemetría", "L/h desde cargas", "Diferencia"],
          rows: [...view.points].sort((a, b) => Math.abs(b.differencePct) - Math.abs(a.differencePct)).map((point) => [
            point.equipment, monthText(point.month), numberText(point.y, 2), numberText(point.x, 2), pctText(point.differencePct),
          ]),
          excel,
        } : undefined}
        empty={summary ? null : {
          label: "Ningún equipo tiene telemetría y cargas con L/h en el mismo mes",
          hint: "La telemetría llega, pero no hay cargas del mismo equipo y mes con su rendimiento en L/h para compararla. Aparecen al registrar cargas de esos equipos con su horómetro, en terreno o en la planilla.",
          ...(cargasHref ? { ctaLabel: "Ver las cargas", ctaHref: cargasHref } : {}),
        }}
      >
        <LphScatterChartLazy view={view} />
        {listed.length > 0 ? (
          <div className="mt-3">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">Fuera de la banda de ±{LPH_BAND_PCT} %</h4>
            <ul className="mt-1 divide-y divide-[var(--color-border)] text-sm">
              {listed.map((point) => {
                const href = equipmentHref?.(point.vehicleId)
                return (
                  <li key={point.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                    <span className="font-medium">
                      {href ? <Link href={href} className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" title="Abrir la ficha del equipo">{point.equipment}</Link> : point.equipment}
                    </span>
                    <span className="text-[var(--color-text-muted)]">{monthText(point.month)}</span>
                    <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{lph(point.y)} en telemetría · {lph(point.x)} en cargas</span>
                    <span className="font-mono text-xs font-semibold tabular-nums text-[var(--color-text)]">{point.differencePct > 0 ? "+" : "−"}{pctText(Math.abs(point.differencePct))}</span>
                  </li>
                )
              })}
            </ul>
            {view.outside.length > listed.length ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">Se listan {listed.length} de {view.outside.length}; «Ver datos» trae todos.</p> : null}
          </div>
        ) : null}
        {notes.length > 0 ? (
          <ul className="mt-3 grid gap-0.5 text-xs text-[var(--color-text-muted)]">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        ) : null}
      </ChartSection>
      <LitersPerHourTable rows={rows} />
    </div>
  )
}

/** V-09: los 20 días de mayor % en vacío (con al menos 1 hora de funcionamiento). */
export function TopIdleDaysTable({ rows }: { rows: IdleTopDay[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Ningún día del período tiene al menos 1 hora de funcionamiento.</p>
  }
  return (
    <TableRoot aria-label="Días con mayor porcentaje de motor en vacío">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Equipo</TableHead>
            <TableHead className="text-right">Horas de motor</TableHead>
            <TableHead className="text-right" title="Horas en vacío ÷ horas de funcionamiento del día">% en vacío</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.day}|${row.equipment}`}>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(row.day)}</TableCell>
              <TableCell className="whitespace-nowrap font-medium">{row.equipment}</TableCell>
              <TableCellNum>{numberText(row.operatingHours)} h</TableCellNum>
              <TableCellNum>{pctText(row.idlePct)}</TableCellNum>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
