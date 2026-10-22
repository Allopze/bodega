import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import {
  LOAD_SOURCE_LABELS,
  PERFORMANCE_STATUS_LABELS,
  PERFORMANCE_UNIT_LABELS,
  REVIEW_STATUS_LABELS,
  STAT_MISSING,
  type LoadSource,
  type PerformanceStatus,
  type ReviewStatus,
} from "@/lib/combustibles/control/contracts"
import type { LoadDetailRow } from "@/lib/combustibles/control/queries/performance-detail"
import { formatDateTime, formatQty } from "@/lib/utils"
import { UnitAbbr } from "./stats-tables"

const REVIEW_META: Record<ReviewStatus, StateMetaInput> = {
  ok: { label: REVIEW_STATUS_LABELS.ok, variant: "neutral" },
  flagged: { label: REVIEW_STATUS_LABELS.flagged, variant: "signal" },
  approved: { label: REVIEW_STATUS_LABELS.approved, variant: "success" },
  rejected: { label: REVIEW_STATUS_LABELS.rejected, variant: "danger" },
}

function meterText(row: LoadDetailRow) {
  if (row.meterReading === null) return STAT_MISSING
  const suffix = row.meterType === "hour_meter" ? "h" : row.meterType === "odometer" ? "km" : ""
  return `${formatQty(row.meterReading, undefined, { maximumFractionDigits: 1 })} ${suffix}`.trim()
}

/** R-05: cada carga de la familia, con su lectura, su rendimiento calculado (nunca el declarado) y su estado de revisión. */
export function LoadDetailTable({ rows, canViewPersonal }: { rows: LoadDetailRow[]; canViewPersonal: boolean }) {
  if (rows.length === 0) {
    return <EmptyState compact title="Sin cargas para mostrar" description="No hay cargas de esta familia con estos filtros. Amplía el período o quita la faena, el medio o el equipo elegido." />
  }
  return (
    <TableRoot aria-label="Detalle de cargas de la familia">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fecha y hora</TableHead>
            <TableHead>Equipo</TableHead>
            <TableHead className="text-right" title="Lectura del odómetro (km) u horómetro (h) al cargar">Medidor</TableHead>
            <TableHead className="text-right" title="Rendimiento calculado por el sistema desde las lecturas consecutivas">Rendimiento</TableHead>
            <TableHead className="text-right">Litros</TableHead>
            <TableHead className="text-right" title="Lo que traía la planilla de origen, solo para contrastar. No se usa en ningún promedio">Declarado en planilla</TableHead>
            <TableHead>Supervisor</TableHead>
            <TableHead>Revisión</TableHead>
            <TableHead>Origen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(row.occurredAt)}</TableCell>
              <TableCell>
                <span className="font-medium whitespace-nowrap">{row.code ?? row.plate ?? STAT_MISSING}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{row.worksiteName}</span>
              </TableCell>
              <TableCellNum>{meterText(row)}</TableCellNum>
              <TableCellNum>
                {row.performanceStatus === "computed" && row.performanceValue !== null && row.unit ? (
                  <>
                    {formatQty(row.performanceValue, undefined, { maximumFractionDigits: 2 })} <span className="font-sans text-xs text-[var(--color-text-muted)]"><UnitAbbr unit={row.unit} /></span>
                  </>
                ) : (
                  <span className="font-sans text-xs text-[var(--color-text-muted)]">{PERFORMANCE_STATUS_LABELS[row.performanceStatus as PerformanceStatus] ?? STAT_MISSING}</span>
                )}
              </TableCellNum>
              <TableCellNum>{formatQty(row.liters, undefined, { maximumFractionDigits: 1 })}</TableCellNum>
              <TableCellNum className="text-[var(--color-text-muted)]">
                {row.declaredPerformance === null ? STAT_MISSING : `${formatQty(row.declaredPerformance, undefined, { maximumFractionDigits: 2 })}${row.unit ? ` ${PERFORMANCE_UNIT_LABELS[row.unit]}` : ""}`}
              </TableCellNum>
              <TableCell className={row.supervisor ? undefined : "text-[var(--color-text-muted)]"} title={canViewPersonal ? undefined : "Los nombres de personas requieren el permiso de datos personales"}>
                {canViewPersonal ? (row.supervisor ?? STAT_MISSING) : "Reservado"}
              </TableCell>
              <TableCell>
                <MetaBadge meta={metaFor(REVIEW_META, row.reviewStatus)} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{LOAD_SOURCE_LABELS[row.source as LoadSource] ?? row.source}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
