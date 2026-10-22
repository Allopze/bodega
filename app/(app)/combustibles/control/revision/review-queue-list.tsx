import Link from "next/link"
import { ResponsiveDataListCard } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRow, TableRoot } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { FLAG_REASON_LABELS, LOAD_SOURCE_LABELS, PERFORMANCE_UNIT_TITLES, STAT_MISSING } from "@/lib/combustibles/control/contracts"
import type { ReviewQueueRow } from "@/lib/combustibles/control/review-queue"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { DecisionButtons } from "./decision-buttons"
import { formatMeterReading, formatPerformance } from "./review-helpers"

function equipmentLabel(row: ReviewQueueRow): string {
  const parts = [row.vehicleCode, row.vehiclePlate].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "Equipo sin ficha"
}

function Reasons({ row }: { row: ReviewQueueRow }) {
  if (row.flagReasons.length === 0) return <span className="text-[var(--color-text-faint)]">{STAT_MISSING}</span>
  return (
    <ul className="flex flex-wrap gap-1">
      {row.flagReasons.map((reason) => (
        <li key={reason}><Badge variant="signal" size="sm" className="whitespace-normal normal-case tracking-normal font-sans">{FLAG_REASON_LABELS[reason]}</Badge></li>
      ))}
    </ul>
  )
}

function Average({ row }: { row: ReviewQueueRow }) {
  if (row.vehicleAverage === null) return <span className="text-xs text-[var(--color-text-faint)]">Sin promedio del equipo</span>
  return (
    <span className="text-xs text-[var(--color-text-muted)]">
      Promedio del equipo {formatPerformance(row.vehicleAverage, row.performanceUnit)} ({formatQty(row.vehicleAverageSamples)} {row.vehicleAverageSamples === 1 ? "carga" : "cargas"})
    </span>
  )
}

function Origin({ row }: { row: ReviewQueueRow }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{LOAD_SOURCE_LABELS[row.source]}</span>
      {row.originHref ? (
        <Link href={row.originHref} className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
          Ver origen
        </Link>
      ) : null}
    </div>
  )
}

function Decision({ row }: { row: ReviewQueueRow }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-[var(--color-text)]">{row.reviewNote ?? STAT_MISSING}</span>
      <span className="text-xs text-[var(--color-text-muted)]">
        {row.reviewerName ?? "Sin responsable"}{row.reviewedAt ? ` · ${formatDate(row.reviewedAt)}` : ""}
      </span>
    </div>
  )
}

function PerformanceTitle({ row }: { row: ReviewQueueRow }) {
  const title = row.performanceUnit ? PERFORMANCE_UNIT_TITLES[row.performanceUnit] : undefined
  return <span title={title}>{formatPerformance(row.performanceValue, row.performanceUnit)}</span>
}

/**
 * Cola de revisión: tabla en escritorio y tarjetas bajo `md` (ambas quedan en
 * el DOM; ver la nota de localizadores del contrato del repo).
 */
export function ReviewQueueList({ rows, canDecide, decided }: { rows: ReviewQueueRow[]; canDecide: boolean; decided: boolean }) {
  const showActions = canDecide && !decided
  return (
    <>
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <ResponsiveDataListCard
            key={row.id}
            title={equipmentLabel(row)}
            description={`${row.worksiteName} · ${formatDateTime(row.occurredAt)}`}
            actions={showActions ? <DecisionButtons loadId={row.id} label={`${equipmentLabel(row)}, ${formatQty(row.liters)} L`} /> : undefined}
          >
            <div><dt className="text-[var(--color-text-muted)]">Litros</dt><dd className="tabular-nums">{formatQty(row.liters)} L</dd></div>
            <div><dt className="text-[var(--color-text-muted)]">Lectura</dt><dd className="tabular-nums">{formatMeterReading(row.meterReading, row.meterType)}</dd></div>
            <div className="col-span-2">
              <dt className="text-[var(--color-text-muted)]">Rendimiento calculado</dt>
              <dd className="flex flex-col"><PerformanceTitle row={row} /><Average row={row} /></dd>
            </div>
            <div className="col-span-2"><dt className="mb-1 text-[var(--color-text-muted)]">Motivos</dt><dd><Reasons row={row} /></dd></div>
            <div className="col-span-2"><dt className="mb-0.5 text-[var(--color-text-muted)]">Origen</dt><dd><Origin row={row} /></dd></div>
            {decided ? <div className="col-span-2"><dt className="mb-0.5 text-[var(--color-text-muted)]">Decisión</dt><dd><Decision row={row} /></dd></div> : null}
          </ResponsiveDataListCard>
        ))}
      </div>

      <TableRoot className="hidden md:block" aria-label="Cargas en la cola de revisión">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Lectura</TableHead>
              <TableHead className="text-right">Rendimiento calculado</TableHead>
              <TableHead>Motivos</TableHead>
              <TableHead>Origen</TableHead>
              {decided ? <TableHead>Decisión</TableHead> : null}
              {showActions ? <TableHead className="text-right">Acciones</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(row.occurredAt)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{equipmentLabel(row)}</TableCell>
                <TableCell className="whitespace-nowrap">{row.worksiteName}</TableCell>
                <TableCellNum className="whitespace-nowrap">{formatQty(row.liters)} L</TableCellNum>
                <TableCellNum className="whitespace-nowrap">{formatMeterReading(row.meterReading, row.meterType)}</TableCellNum>
                <TableCellNum>
                  <div className="flex flex-col items-end gap-0.5">
                    <PerformanceTitle row={row} />
                    <Average row={row} />
                  </div>
                </TableCellNum>
                <TableCell className="min-w-48"><Reasons row={row} /></TableCell>
                <TableCell className="whitespace-nowrap"><Origin row={row} /></TableCell>
                {decided ? <TableCell className="min-w-56"><Decision row={row} /></TableCell> : null}
                {showActions ? <TableCell><DecisionButtons loadId={row.id} label={`${equipmentLabel(row)}, ${formatQty(row.liters)} L`} /></TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </>
  )
}
