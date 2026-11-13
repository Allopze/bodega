import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
const REGULARITY_TITLE = `Qué tanto varía el rendimiento de una carga a otra. «Irregular» significa que varía más de ${CV_ALERT_THRESHOLD * 100} % respecto de su promedio.`

/**
 * «Parejo» o «irregular» en vez de desviación estándar: la gente que decide no
 * lee σ. Es la variación de las cargas de un equipo o una faena (CV, σ ÷
 * promedio); sobre 25 % es irregular. Sin 2 o más cargas válidas no se puede
 * decir, y se dice (no se inventa «parejo»).
 */
export function RegularityBadge({ cv }: { cv: number | null }) {
  if (cv === null) {
    return <span className="text-[var(--color-text-faint)]" title="Se necesitan 2 o más cargas válidas para saber si es parejo o irregular">{STAT_MISSING}</span>
  }
  return cv > CV_ALERT_THRESHOLD
    ? <Badge variant="warning" size="sm" title={REGULARITY_TITLE}>Irregular</Badge>
    : <Badge variant="neutral" size="sm" title={REGULARITY_TITLE}>Parejo</Badge>
}

/**
 * R-02 (cifras): promedio, desviación muestral y dispersión por faena y unidad.
 * Vive en «Ver datos estadísticos»: el dato crudo sigue disponible para quien
 * lo quiera, pero ya no es lo primero que se lee.
 */
export function WorksiteStatsTable({ rows }: { rows: WorksiteStatRow[] }) {
  if (rows.length === 0) {
    return <EmptyState compact title="Sin rendimientos calculados" description="Ninguna faena tiene cargas con rendimiento calculado y sin decisión pendiente con estos filtros. Amplía el período o quita la faena." />
  }
  return (
    <TableRoot framed={false} aria-label="Cifras estadísticas del rendimiento por faena">
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
    </TableCellNum>
  )
}

/** ¿Tiene el equipo alguna cifra que mostrar además de su nombre? */
function hasAnyFigure(row: EquipmentStatRow): boolean {
  return [row.mean, row.modelMean, row.historyMean, row.deltaModelPct, row.deltaHistoryPct].some((value) => value !== null)
}

/** Qué comparación dice «rinde peor»: contra su modelo, contra su historial, o las dos. */
function worseTitle(row: Pick<EquipmentStatRow, "worseThanModel" | "worseThanHistory">): string {
  const against = [row.worseThanModel ? "su modelo" : null, row.worseThanHistory ? "su propio historial" : null].filter(Boolean).join(" y ")
  return `Rinde más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} % peor que ${against}`
}

/**
 * Una fila por equipo: cuánto rinde, contra su modelo y contra su historial de
 * 12 meses, si sus cargas son parejas o irregulares y si «rinde peor». El
 * código del equipo abre su ficha.
 */
export function EquipmentStatsTable({ rows: allRows, equipmentHref, clearFiltersHref }: { rows: EquipmentStatRow[]; equipmentHref?: (vehicleId: string) => string; clearFiltersHref?: string }) {
  if (allRows.length === 0) {
    return (
      <EmptyState
        compact
        title="Sin equipos con cargas"
        description="Ningún equipo de esta familia tiene cargas con estos filtros. Amplía el período, o quita la faena, el medio o el equipo elegido."
        action={clearFiltersHref ? <Button asChild variant="secondary" size="sm"><Link href={clearFiltersHref}>Quitar filtros</Link></Button> : undefined}
      />
    )
  }
  // Un equipo con cargas pero sin ninguna cifra de rendimiento sería una fila de «—» de punta a punta: no dice nada.
  const rows = allRows.filter(hasAnyFigure)
  const hidden = allRows.length - rows.length
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="Ningún equipo tiene rendimiento calculado"
        description="Los equipos de esta familia tienen cargas, pero sin las lecturas de medidor que hacen falta para calcular un rendimiento. Se completan con las lecturas de cada carga."
        action={clearFiltersHref ? <Button asChild variant="secondary" size="sm"><Link href={clearFiltersHref}>Quitar filtros</Link></Button> : undefined}
      />
    )
  }
  return (
    <>
    <TableRoot aria-label="Rendimiento por equipo">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Equipo</TableHead>
            <TableHead title="Faena en la ficha del equipo">Faena</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead className="text-right" title="Promedio de sus cargas válidas en el período">Rendimiento</TableHead>
            <TableHead className="text-right" title="Promedio de los demás equipos de la misma marca y modelo, con los mismos filtros">Su modelo</TableHead>
            <TableHead className="text-right" title="Promedio de las cargas válidas del equipo en los 12 meses anteriores al período">Su historial</TableHead>
            <TableHead className="text-right" title={`Diferencia contra el promedio del modelo. Se avisa si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`}>Dif. modelo</TableHead>
            <TableHead className="text-right" title={`Diferencia contra su historial. Se avisa si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`}>Dif. historial</TableHead>
            <TableHead title={REGULARITY_TITLE}>Carga a carga</TableHead>
            <TableHead>Aviso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const worse = row.worseThanModel || row.worseThanHistory
            const label = row.code ?? row.plate
            const href = equipmentHref?.(row.vehicleId)
            return (
              <TableRow key={row.vehicleId}>
                <TableCell className="whitespace-nowrap">
                  {href ? (
                    <Link href={href} className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" title="Abrir la ficha del equipo">
                      {label}
                    </Link>
                  ) : <span className="font-medium">{label}</span>}
                  {row.code ? <span className="block text-xs text-[var(--color-text-muted)]">{row.plate}</span> : null}
                </TableCell>
                <TableCell>{row.worksiteName ?? STAT_MISSING}</TableCell>
                <TableCell>{[row.brand, row.model].filter(Boolean).join(" ") || STAT_MISSING}</TableCell>
                <TableCellNum>{row.mean === null ? STAT_MISSING : <>{stat(row.mean)} <span className="font-sans text-xs text-[var(--color-text-muted)]"><UnitAbbr unit={row.unit} /></span></>}</TableCellNum>
                <TableCellNum>{stat(row.modelMean)}</TableCellNum>
                <TableCellNum>{stat(row.historyMean)}</TableCellNum>
                <DeltaCell value={row.deltaModelPct} worse={row.worseThanModel} />
                <DeltaCell value={row.deltaHistoryPct} worse={row.worseThanHistory} />
                <TableCell><RegularityBadge cv={row.cv} /></TableCell>
                <TableCell>{worse ? <Badge variant="danger" size="sm" title={worseTitle(row)}>Rinde peor</Badge> : null}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
    {hidden > 0 ? (
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {hidden === 1 ? "1 equipo de la lista no tiene" : `${hidden} equipos de la lista no tienen`} rendimiento calculado y no se muestra{hidden === 1 ? "" : "n"} aquí.
      </p>
    ) : null}
    </>
  )
}

/**
 * Las cifras que antes eran la tabla principal: tipo, marca, unidad, cargas
 * válidas, promedio, desviación estándar y variación, por equipo. Para «Ver
 * datos estadísticos».
 */
export function EquipmentStatisticsTable({ rows }: { rows: EquipmentStatRow[] }) {
  if (rows.length === 0) return null
  return (
    <TableRoot framed={false} aria-label="Cifras estadísticas del rendimiento por equipo">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Equipo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead className="text-right">Cargas</TableHead>
            <TableHead className="text-right">Promedio</TableHead>
            <TableHead className="text-right" title={SIGMA_TITLE}>Desv. estándar</TableHead>
            <TableHead className="text-right" title="Coeficiente de variación: desviación estándar dividida por el promedio">Variación (CV)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.vehicleId}>
              <TableCell className="whitespace-nowrap font-medium">{row.code ?? row.plate}{row.code ? <span className="block text-xs font-normal text-[var(--color-text-muted)]">{row.plate}</span> : null}</TableCell>
              <TableCell>{row.equipmentType ?? STAT_MISSING}</TableCell>
              <TableCell>{row.brand ?? STAT_MISSING}</TableCell>
              <TableCell><UnitAbbr unit={row.unit} /></TableCell>
              <TableCellNum>{formatQty(row.n)}</TableCellNum>
              <TableCellNum>{stat(row.mean)}</TableCellNum>
              <TableCellNum>{stat(row.sd)}</TableCellNum>
              <TableCellNum>{row.cv === null ? STAT_MISSING : `${formatQty(row.cv * 100, undefined, { maximumFractionDigits: 0 })} %`}</TableCellNum>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
