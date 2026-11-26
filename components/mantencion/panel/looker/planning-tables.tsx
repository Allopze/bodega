"use client"

import { PencilSimple } from "@phosphor-icons/react"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { PanelBlock } from "@/components/ui/dashboard-panel"
import { TableCell, TableCellNum } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import { equipmentAction } from "@/lib/services/mantencion/looker/filters"
import { deltaTone, remainingTone, type PlanningTone } from "@/lib/services/mantencion/looker/planning-rules"
import type { PlanningRow } from "@/lib/services/mantencion/looker/types"
import { cn, formatDate, formatQty } from "@/lib/utils"
import { CrossFilterRow } from "./cross-filter-row"
import { FilterToggle } from "./filter-toggle"

const TONE: Record<PlanningTone, string> = {
  ok: "text-[var(--color-success-ink)]",
  warn: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
  muted: "text-[var(--color-text-muted)]",
}

function numberText(value: number | null): string {
  return value == null ? "—" : formatQty(value)
}

function signedText(value: number | null): string {
  if (value == null) return "—"
  return `${value > 0 ? "+" : ""}${formatQty(value)}`
}

function ToneCell({
  value,
  tone,
  title,
}: {
  value: number | null
  tone: PlanningTone
  title?: string
}) {
  return (
    <TableCellNum className={TONE[tone]} title={title}>
      <span className="inline-flex items-center gap-1.5">
        {value != null && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
        {value == null ? "—" : formatQty(value)}
      </span>
    </TableCellNum>
  )
}

/**
 * Tabla de un consolidado de Planificación (km u horas). La fila entera filtra por el equipo;
 * el botón del identificador es el control de teclado (`aria-pressed`). La tabla que originó
 * el clic no se filtra a sí misma: sigue mostrando todos los equipos del alcance.
 */
export function PlanningTable({
  title,
  unit,
  rows,
  selectedId,
  note,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  unit: "km" | "h"
  rows: PlanningRow[]
  selectedId: string | null
  note: string
  emptyTitle: string
  emptyDescription: string
}) {
  const unitLabel = unit === "km" ? "Km" : "Horas"
  const columns: ColumnDef[] = [
    { key: "plate", label: "Patente", sortable: true, width: "w-28" },
    { key: "code", label: "Código", sortable: true, width: "w-28" },
    { key: "lastDate", label: "Última mantención", sortable: true, sortValue: (row: PlanningRow) => row.lastDate ?? "" },
    { key: "programmed", label: `${unitLabel} ${unit === "km" ? "programados" : "programadas"} (A)`, numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.programmed ?? Number.NEGATIVE_INFINITY },
    { key: "real", label: `${unitLabel} reales (B)`, numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.real ?? Number.NEGATIVE_INFINITY },
    { key: "current", label: `${unitLabel} actuales`, numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.current ?? Number.NEGATIVE_INFINITY },
    { key: "next", label: "Próxima mantención", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.next ?? Number.NEGATIVE_INFINITY },
    { key: "delta", label: "Delta (A − B)", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.delta ?? Number.NEGATIVE_INFINITY },
    { key: "remaining", label: "Faltantes", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.remaining ?? Number.POSITIVE_INFINITY },
  ]

  return (
    <PanelBlock padding="none">
      <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-eyebrow text-[var(--color-text)]">{title}</h3>
          <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(rows.length, "equipo", "equipos")}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p>
      </div>
      <DataTable
        caption={title}
        columns={columns}
        rows={rows}
        searchKeys={["code", "plate", "typeName", "worksiteName", "scheduleName"]}
        disableInternalSearch
        hideDensityToggle
        stickyFirstColumn
        framed={false}
        pageSize={50}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        tableClassName="text-xs"
        renderRow={(row) => {
          const action = equipmentAction(row.vehicleId, selectedId === row.vehicleId)
          const remaining = remainingTone(row)
          const delta = deltaTone(row)
          return (
            <CrossFilterRow key={row.vehicleId} action={action} active={selectedId === row.vehicleId}>
              <TableCell nowrap>
                <FilterToggle action={action} className="font-mono text-xs font-semibold">
                  {row.plate || row.code || "—"}
                </FilterToggle>
              </TableCell>
              <TableCell nowrap className="font-mono text-xs" title={`${row.scheduleName ?? "Sin pauta"} · ${row.frequency ? formatQty(row.frequency) : "Sin frecuencia"}`}>
                {row.code || "—"}
              </TableCell>
              <TableCell nowrap>
                {/* Sin período en esta pestaña no hay «fuera de rango» que avisar: `outOfRange` sólo lo usa el Excel. */}
                <span className="font-mono text-xs">
                  {row.lastDate ? formatDate(row.lastDate) : "Sin mantención"}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
                  {row.manual && (
                    <span className="inline-flex items-center gap-1 text-[var(--color-warning-ink)]" title={row.manualReason ?? "Ajustada a mano"}>
                      <PencilSimple size={11} weight="bold" aria-hidden />
                      Ajustada
                      <span className="sr-only">{row.manualReason ?? "a mano"}</span>
                    </span>
                  )}
                  {row.declared && (
                    <span className="text-[var(--color-text-muted)]" title={row.evidence ? `Respaldo: ${row.evidence}` : "Preventiva declarada"}>
                      Declarada
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCellNum title={row.programmed == null ? "Sin una mantención programada" : undefined}>{numberText(row.programmed)}</TableCellNum>
              <TableCellNum title={row.real == null ? "Sin lectura de la última mantención" : undefined}>{numberText(row.real)}</TableCellNum>
              <TableCellNum className={row.current == null ? TONE.muted : undefined} title={row.current == null ? "El equipo no tiene lecturas" : undefined}>
                {row.current == null ? "Sin lectura" : formatQty(row.current)}
              </TableCellNum>
              <TableCellNum className={row.next == null ? TONE.muted : undefined} title={row.next == null ? "Sin pauta o sin preventiva" : undefined}>
                {row.next == null ? "Sin pauta" : formatQty(row.next)}
              </TableCellNum>
              <ToneCell
                value={row.delta}
                tone={delta}
                title={row.delta == null ? "Sin datos para comparar" : row.delta >= 0 ? `Se hizo ${formatQty(row.delta)} antes` : `Se hizo ${formatQty(Math.abs(row.delta))} después`}
              />
              <ToneCell
                value={row.remaining}
                tone={remaining}
                title={row.remaining == null ? "Sin pauta o sin lectura" : row.remaining <= 0 ? `Vencida por ${formatQty(Math.abs(row.remaining))}` : `Faltan ${formatQty(row.remaining)}`}
              />
            </CrossFilterRow>
          )
        }}
        renderMobileCard={(row) => {
          const action = equipmentAction(row.vehicleId, selectedId === row.vehicleId)
          return (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-start justify-between gap-2">
                <FilterToggle action={action} className="font-mono text-sm font-semibold">
                  {row.plate || row.code || "—"}
                </FilterToggle>
                <span className={cn("font-mono text-xs tabular-nums", TONE[remainingTone(row)])}>
                  {row.remaining == null ? "Sin dato" : `Faltan ${formatQty(row.remaining)}`}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><dt className="text-[var(--color-text-muted)]">Código</dt><dd className="font-mono">{row.code || "—"}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Última</dt><dd className="font-mono">{row.lastDate ? formatDate(row.lastDate) : "Sin mantención"}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">A / B</dt><dd className="font-mono">{numberText(row.programmed)} / {numberText(row.real)}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Actual / próxima</dt><dd className="font-mono">{numberText(row.current)} / {numberText(row.next)}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Delta</dt><dd className={cn("font-mono tabular-nums", TONE[deltaTone(row)])}>{signedText(row.delta)}</dd></div>
              </dl>
            </div>
          )
        }}
      />
    </PanelBlock>
  )
}
