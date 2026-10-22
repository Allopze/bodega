import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PERFORMANCE_UNIT_TITLES } from "@/lib/combustibles/control/contracts"
import type { LitersPerHourComparisonRow } from "@/lib/combustibles/control/queries/idle-comparison"
import type { IdleTopDay } from "@/lib/combustibles/control/queries/idle"
import { formatDate } from "@/lib/utils"
import { monthText, numberText, pctText } from "../sellos/format"

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

/** V-09: los 20 días de mayor % en vacío (con al menos 1 hora de funcionamiento). */
export function TopIdleDaysTable({ rows }: { rows: IdleTopDay[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Ningún día del período tiene al menos 1 hora de funcionamiento.</p>
  }
  return (
    <TableRoot aria-label="Días con mayor porcentaje en vacío">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Equipo</TableHead>
            <TableHead className="text-right">Horas func.</TableHead>
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
