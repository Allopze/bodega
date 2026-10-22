import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES, STAT_MISSING, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { EquipmentStatRow, WorksiteStatRow } from "@/lib/combustibles/control/queries/performance"
import { CV_ALERT_THRESHOLD, WORSE_PERFORMANCE_THRESHOLD_PCT } from "@/lib/combustibles/control/view-helpers"
import { cn, formatQty } from "@/lib/utils"

const stat = (value: number | null) => (value === null ? STAT_MISSING : formatQty(value, undefined, { maximumFractionDigits: 2 }))

function signed(value: number | null) {
  if (value === null) return STAT_MISSING
  const text = formatQty(Math.abs(value), undefined, { maximumFractionDigits: 1 })
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text} %`
}

export function UnitAbbr({ unit }: { unit: PerformanceUnit }) {
  return <abbr title={PERFORMANCE_UNIT_TITLES[unit]} className="no-underline decoration-dotted underline-offset-2 hover:underline">{PERFORMANCE_UNIT_LABELS[unit]}</abbr>
}

const SIGMA_TITLE = "Desviación estándar muestral. Se calcula con 2 o más cargas válidas."

/** R-02: promedio, desviación muestral y dispersión por faena y unidad. */
export function WorksiteStatsTable({ rows }: { rows: WorksiteStatRow[] }) {
  if (rows.length === 0) {
    return <EmptyState compact title="Sin rendimientos calculados" description="Ninguna faena tiene cargas con rendimiento calculado y sin revisión pendiente con estos filtros. Amplía el período o quita la faena." />
  }
  return (
    <TableRoot aria-label="Rendimiento por faena">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Faena</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead className="text-right">Cargas</TableHead>
            <TableHead className="text-right">Promedio</TableHead>
            <TableHead className="text-right" title={SIGMA_TITLE}>Desv. estándar</TableHead>
            <TableHead title="Coeficiente de variación: desviación estándar dividida por el promedio. Sobre 25 % se considera alta.">Dispersión</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const high = row.cv !== null && row.cv > CV_ALERT_THRESHOLD
            return (
              <TableRow key={`${row.worksiteId}-${row.unit}`}>
                <TableCell className="font-medium">{row.worksiteName}</TableCell>
                <TableCell><UnitAbbr unit={row.unit} /></TableCell>
                <TableCellNum>{formatQty(row.n)}</TableCellNum>
                <TableCellNum>{stat(row.mean)}</TableCellNum>
                <TableCellNum>{stat(row.sd)}</TableCellNum>
                <TableCell>
                  {row.cv === null ? (
                    <span className="text-[var(--color-text-faint)]" title="Se necesitan 2 o más cargas válidas">{STAT_MISSING}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <span
                          className={cn("block h-full rounded-full", high ? "bg-[var(--color-warning)]" : "bg-[var(--color-text-faint)]")}
                          style={{ width: `${Math.min(100, (row.cv / 0.5) * 100)}%` }}
                        />
                      </span>
                      <span className="tabular-nums">{formatQty(row.cv * 100, undefined, { maximumFractionDigits: 0 })} %</span>
                      {high ? <span className="text-xs font-semibold text-[var(--color-warning-ink)]">Alta: sobre {CV_ALERT_THRESHOLD * 100} %</span> : null}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}

function DeltaCell({ value, worse }: { value: number | null; worse: boolean }) {
  return (
    <TableCellNum>
      <span className={worse ? "font-semibold text-[var(--color-danger-ink)]" : undefined}>{signed(value)}</span>
      {worse ? <span className="block font-sans text-[11px] font-semibold leading-tight text-[var(--color-danger-ink)]">Rinde peor</span> : null}
    </TableCellNum>
  )
}

/** R-03 + R-06: una fila por equipo con su comparación contra el modelo y contra su histórico. */
export function EquipmentStatsTable({ rows }: { rows: EquipmentStatRow[] }) {
  if (rows.length === 0) {
    return <EmptyState compact title="Sin equipos con cargas" description="Ningún equipo de esta familia tiene cargas con estos filtros. Amplía el período, o quita la faena, el medio o el equipo elegido." />
  }
  return (
    <TableRoot aria-label="Rendimiento por equipo">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead title="Faena en la ficha del equipo">Faena</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Patente</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead className="text-right">Cargas</TableHead>
            <TableHead className="text-right">Promedio</TableHead>
            <TableHead className="text-right" title={SIGMA_TITLE}>Desv. estándar</TableHead>
            <TableHead className="text-right" title="Promedio de los demás equipos de la misma marca y modelo, con los mismos filtros">Promedio del modelo</TableHead>
            <TableHead className="text-right" title={`Diferencia contra el promedio del modelo. Se marca «Rinde peor» si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`}>Δ vs modelo</TableHead>
            <TableHead className="text-right" title="Promedio de las cargas válidas del equipo en los 12 meses anteriores al período">Su histórico</TableHead>
            <TableHead className="text-right" title={`Diferencia contra su histórico. Se marca «Rinde peor» si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`}>Δ vs histórico</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.vehicleId}>
              <TableCell>{row.worksiteName ?? STAT_MISSING}</TableCell>
              <TableCell className="font-medium whitespace-nowrap">{row.code ?? STAT_MISSING}</TableCell>
              <TableCell className="whitespace-nowrap">{row.plate}</TableCell>
              <TableCell>{row.brand ?? STAT_MISSING}</TableCell>
              <TableCell>{row.model ?? STAT_MISSING}</TableCell>
              <TableCell>{row.equipmentType ?? STAT_MISSING}</TableCell>
              <TableCell><UnitAbbr unit={row.unit} /></TableCell>
              <TableCellNum>{formatQty(row.n)}</TableCellNum>
              <TableCellNum>{stat(row.mean)}</TableCellNum>
              <TableCellNum>{stat(row.sd)}</TableCellNum>
              <TableCellNum>{stat(row.modelMean)}</TableCellNum>
              <DeltaCell value={row.deltaModelPct} worse={row.worseThanModel} />
              <TableCellNum>{stat(row.historyMean)}</TableCellNum>
              <DeltaCell value={row.deltaHistoryPct} worse={row.worseThanHistory} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
