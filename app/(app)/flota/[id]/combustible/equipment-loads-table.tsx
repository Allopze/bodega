import Link from "next/link"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PERFORMANCE_UNIT_LABELS, REVIEW_STATUS_LABELS, STAT_MISSING, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { EquipmentFileLoad } from "@/lib/combustibles/equipment/types"
import { formatDateTime, formatQty } from "@/lib/utils"

const REVIEW_META: Record<string, StateMetaInput> = {
  flagged: { label: REVIEW_STATUS_LABELS.flagged, variant: "signal" },
  approved: { label: REVIEW_STATUS_LABELS.approved, variant: "success" },
  rejected: { label: REVIEW_STATUS_LABELS.rejected, variant: "danger" },
}

function meterText(load: EquipmentFileLoad) {
  if (load.meterReading === null) return STAT_MISSING
  const suffix = load.meterType === "hour_meter" ? "h" : load.meterType === "odometer" ? "km" : ""
  return `${formatQty(load.meterReading, undefined, { maximumFractionDigits: 1 })} ${suffix}`.trim()
}

/**
 * «Últimas cargas» del equipo en el período: fecha (abre la ficha de la carga),
 * litros, lectura, rendimiento o el motivo por el que no se pudo calcular, cómo
 * llegó y en qué estado está. Una carga por decidir o que no cuenta se ve con su
 * estado, no se esconde.
 */
export function EquipmentLoadsTable({ rows, unit }: { rows: EquipmentFileLoad[]; unit: PerformanceUnit | null }) {
  if (rows.length === 0) {
    return <EmptyState compact title="Sin cargas en este período" description="El equipo no tiene cargas registradas entre estas fechas. Cambia el período para ver otras, o registra una carga." />
  }
  return (
    <TableRoot aria-label="Últimas cargas del equipo">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fecha y hora</TableHead>
            <TableHead className="text-right">Litros</TableHead>
            <TableHead className="text-right" title="Lectura del odómetro (km) u horómetro (h) al cargar">Lectura</TableHead>
            <TableHead className="text-right" title="Rendimiento calculado por el sistema desde las lecturas consecutivas">Rendimiento</TableHead>
            <TableHead>Cómo llegó</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((load) => (
            <TableRow key={load.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {load.href ? (
                  <Link href={load.href} className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" title="Abrir la ficha de la carga">
                    {formatDateTime(load.occurredAt)}
                  </Link>
                ) : formatDateTime(load.occurredAt)}
              </TableCell>
              <TableCellNum>{formatQty(load.liters, undefined, { maximumFractionDigits: 1 })}</TableCellNum>
              <TableCellNum>{meterText(load)}</TableCellNum>
              <TableCellNum>
                {load.performanceValue !== null && unit ? (
                  <>{formatQty(load.performanceValue, undefined, { maximumFractionDigits: 2 })} <span className="font-sans text-xs text-[var(--color-text-muted)]">{PERFORMANCE_UNIT_LABELS[unit]}</span></>
                ) : (
                  <span className="font-sans text-xs text-[var(--color-text-muted)]">{load.performanceNote ?? STAT_MISSING}</span>
                )}
              </TableCellNum>
              <TableCell className="whitespace-nowrap">{load.originLabel}</TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  {load.stateLabel ? <span className="text-sm">{load.stateLabel}</span> : null}
                  {load.reviewStatus !== "ok" ? <MetaBadge meta={metaFor(REVIEW_META, load.reviewStatus)} /> : null}
                  {!load.stateLabel && load.reviewStatus === "ok" ? <span className="text-[var(--color-text-faint)]">{STAT_MISSING}</span> : null}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
