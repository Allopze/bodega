import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import type { WorkOrderListRow } from "@/lib/services/mantencion/work-orders/types"
import { formatDate, formatDateTime } from "@/lib/utils"
import { OT_STATE_META, equipmentText, workOrderTypeText } from "./ot-labels"

/** Lo vencido va en tono de señal, nunca rojo (el rojo es de lo anulado). */
const OVERDUE = "font-semibold text-[var(--color-signal-ink)]"
const QUIET = "text-[var(--color-text-muted)]"

/** Entrega estimada: la fecha y, si ya pasó y la OT sigue en taller, «vencida» en texto (no sólo color). */
export function EstimateCell({ row }: { row: Pick<WorkOrderListRow, "estimatedDeliveryDate" | "estimateOverdue"> }) {
  if (!row.estimatedDeliveryDate) return <span className={QUIET}>—</span>
  return (
    <span className={row.estimateOverdue ? OVERDUE : undefined} data-overdue={row.estimateOverdue ? "true" : undefined}>
      <span className="whitespace-nowrap font-mono tabular-nums">{formatDate(row.estimatedDeliveryDate)}</span>
      {row.estimateOverdue && <span className="block text-xs">Vencida</span>}
    </span>
  )
}

function daysText(row: WorkOrderListRow): string {
  if (row.daysInWorkshop == null) return "—"
  return row.daysInWorkshop === 0 ? "Desde hoy" : plural(row.daysInWorkshop, "día", "días")
}

function StatusCell({ row }: { row: WorkOrderListRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <MetaBadge meta={OT_STATE_META[row.status]} size="sm" />
      {row.rejectionCount > 0 && row.status !== "cerrada" && row.status !== "anulada" && (
        <span className="text-xs font-medium text-[var(--color-signal-ink)]">
          {row.rejectionCount === 1 ? "Devuelta 1 vez" : `Devuelta ${row.rejectionCount} veces`}
        </span>
      )}
    </div>
  )
}

/**
 * Lista de OT. Componente de servidor. En escritorio una tabla; bajo `md` las
 * mismas filas como tarjetas con una acción de 44 px. Ambas quedan en el DOM
 * (ver «Locators in this repository» de AGENTS.md).
 */
export function OtTable({ rows }: { rows: WorkOrderListRow[] }) {
  return (
    <>
      <ul aria-label="Órdenes de trabajo como tarjetas" className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <ResponsiveDataListCard
              title={<span className="font-mono text-[13px] font-semibold">{row.folio}</span>}
              description={<>{equipmentText(row)} · {row.worksiteName}</>}
              status={<MetaBadge meta={OT_STATE_META[row.status]} size="sm" />}
              actions={(
                <Button asChild variant="secondary" size="sm" className="w-full">
                  <Link href={`/mantencion/ot/${row.id}`} aria-label={`Ver la OT ${row.folio}`}>Ver la OT</Link>
                </Button>
              )}
            >
              <ResponsiveDataListField label="Tipo"><span className="text-[var(--color-text)]">{workOrderTypeText(row)}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="Mecánico"><span className="text-[var(--color-text)]">{row.assignedToName ?? "Sin asignar"}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="Ingreso">
                <span className="whitespace-nowrap font-mono tabular-nums text-[var(--color-text)]">{row.workshopEntryAt ? formatDateTime(row.workshopEntryAt) : "—"}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Entrega estimada"><EstimateCell row={row} /></ResponsiveDataListField>
              <ResponsiveDataListField label="Días en taller"><span className="text-[var(--color-text)]">{daysText(row)}</span></ResponsiveDataListField>
            </ResponsiveDataListCard>
          </li>
        ))}
      </ul>

      <TableRoot className="hidden md:block" aria-label="Órdenes de trabajo">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Folio</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Mecánico</TableHead>
              <TableHead>Ingreso</TableHead>
              <TableHead>Entrega estimada</TableHead>
              <TableHead>Días en taller</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={row.status === "anulada" ? "bg-[var(--color-surface-2)]/60" : undefined}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/mantencion/ot/${row.id}`}
                    className="font-mono text-[13px] font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
                    aria-label={`Ver la OT ${row.folio}`}
                  >
                    {row.folio}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px]">{equipmentText(row)}</TableCell>
                <TableCell>{row.worksiteName}</TableCell>
                <TableCell className="whitespace-nowrap">{workOrderTypeText(row)}</TableCell>
                <TableCell><StatusCell row={row} /></TableCell>
                <TableCell>{row.assignedToName ?? <span className={QUIET}>Sin asignar</span>}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{row.workshopEntryAt ? formatDateTime(row.workshopEntryAt) : <span className={QUIET}>—</span>}</TableCell>
                <TableCell className="text-[13px]"><EstimateCell row={row} /></TableCell>
                <TableCell className="whitespace-nowrap">{daysText(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </>
  )
}
