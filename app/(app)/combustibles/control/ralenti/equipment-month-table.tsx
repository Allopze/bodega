import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { IdleEquipmentMonthRow, IdleStats } from "@/lib/combustibles/control/queries/idle"
import type { PaginationState } from "@/lib/pagination"
import { litersText, monthText, numberText, pctText } from "../sellos/format"

const hours = (value: number | null) => (value === null ? "—" : `${numberText(value)} h`)

function StatCells({ stats }: { stats: IdleStats }) {
  return (
    <>
      <TableCellNum>{hours(stats.operatingHours)}</TableCellNum>
      <TableCellNum>{pctText(stats.idlePct)}</TableCellNum>
      <TableCellNum>{pctText(stats.dailyAvgPct)}</TableCellNum>
      <TableCellNum>{pctText(stats.dailyMaxPct)}</TableCellNum>
      <TableCellNum>{pctText(stats.dailyMinPct)}</TableCellNum>
      <TableCellNum>{hours(stats.avgWorkingPerDay)}</TableCellNum>
      <TableCellNum>{hours(stats.avgIdlePerDay)}</TableCellNum>
      <TableCellNum>{litersText(stats.litersWorking)}</TableCellNum>
      <TableCellNum>{litersText(stats.litersIdle)}</TableCellNum>
    </>
  )
}

interface Props { rows: IdleEquipmentMonthRow[]; total: IdleStats | null; pagination: PaginationState; hrefForPage: (page: number) => string }

/** V-01..V-05: una fila por equipo y mes, con el total general al pie. */
export function EquipmentMonthTable({ rows, total, pagination, hrefForPage }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay telemetría en este período. Prueba con otro mes o importa el archivo de telemetría de los equipos.</p>
  }
  return (
    <TableRoot aria-label="Ralentí por equipo y mes">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Equipo</TableHead>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right" title="Horas de funcionamiento del motor en el mes">Horas func.</TableHead>
            <TableHead className="text-right" title="Horas en vacío ÷ horas de funcionamiento del mes">% en vacío</TableHead>
            <TableHead className="text-right" title="Promedio de los porcentajes en vacío de cada día">Prom. diario</TableHead>
            <TableHead className="text-right" title="Mayor porcentaje en vacío de un día del mes">Máx. diario</TableHead>
            <TableHead className="text-right" title="Menor porcentaje en vacío de un día del mes">Mín. diario</TableHead>
            <TableHead className="text-right" title="Horas trabajando por día con actividad">H trab./día</TableHead>
            <TableHead className="text-right" title="Horas en vacío por día con actividad">H vacío/día</TableHead>
            <TableHead className="text-right">L trabajando</TableHead>
            <TableHead className="text-right">L en vacío</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.vehicleId}|${row.month}`}>
              <TableCell className="whitespace-nowrap font-medium">{row.equipment}</TableCell>
              <TableCell className="whitespace-nowrap">{monthText(row.month)}</TableCell>
              <StatCells stats={row} />
            </TableRow>
          ))}
        </TableBody>
        {total ? (
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell colSpan={2}>Total general</TableCell>
              <StatCells stats={total} />
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
    </TableRoot>
  )
}
