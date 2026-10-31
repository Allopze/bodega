import Link from "next/link"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { IdleEquipmentSummary } from "@/lib/combustibles/control/queries/idle-summary"
import { litersText, numberText, pctText } from "../../control/_components/format"

const hours = (value: number) => `${numberText(value)} h`

/**
 * «Equipos con más tiempo en vacío»: los equipos que más horas pasan con el
 * motor encendido sin trabajar en el período, con su % y los litros que eso
 * costó. El código abre la ficha del equipo; la tabla por equipo y mes con todas
 * las cifras sigue más abajo, plegada.
 */
export function IdleTopEquipmentTable({ rows, equipmentHref, limit = 10 }: { rows: IdleEquipmentSummary[]; equipmentHref?: (vehicleId: string) => string; limit?: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay telemetría en este período. Prueba con otro período o agrega la telemetría de los equipos.</p>
  }
  const shown = rows.slice(0, limit)
  return (
    <div className="grid gap-2">
      <TableRoot aria-label="Equipos con más tiempo con el motor en vacío">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipo</TableHead>
              <TableHead className="text-right" title="Horas de funcionamiento del motor en el período">Horas de motor</TableHead>
              <TableHead className="text-right" title="Horas en vacío ÷ horas de motor">En vacío</TableHead>
              <TableHead className="text-right" title="Horas con el motor en vacío en el período">Horas en vacío</TableHead>
              <TableHead className="text-right" title="Mayor porcentaje en vacío de un día del período">Máximo en un día</TableHead>
              <TableHead className="text-right" title="Litros que se gastaron con el motor en vacío, si la telemetría los informa">Litros en vacío</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const href = equipmentHref?.(row.vehicleId)
              return (
                <TableRow key={row.vehicleId}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {href ? (
                      <Link href={href} className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" title="Abrir la ficha del equipo">{row.equipment}</Link>
                    ) : row.equipment}
                  </TableCell>
                  <TableCellNum>{hours(row.operatingHours)}</TableCellNum>
                  <TableCellNum>{pctText(row.idlePct)}</TableCellNum>
                  <TableCellNum>{hours(row.idleHours)}</TableCellNum>
                  <TableCellNum>{pctText(row.dailyMaxPct)}</TableCellNum>
                  <TableCellNum>{litersText(row.litersIdle)}</TableCellNum>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
      {rows.length > shown.length ? (
        <p className="text-xs text-[var(--color-text-muted)]">Se muestran los {shown.length} equipos con más horas en vacío de {rows.length}; «Por equipo y mes» trae todos.</p>
      ) : null}
    </div>
  )
}
