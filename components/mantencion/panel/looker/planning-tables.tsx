"use client"

import { PencilSimple } from "@phosphor-icons/react"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { PanelBlock } from "@/components/ui/dashboard-panel"
import { TableCell, TableCellNum } from "@/components/ui/table"
import { historyHref, parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MantUnit } from "@/lib/mantencion/types"
import { plural } from "@/lib/mantencion/format"
import { equipmentAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import {
  PLANNING_STATE_NAME, estimateLine, planningStateOf, remainingText, remainingTone, timingDetail, timingText, timingTone, usageText, type PlanningTone,
} from "@/lib/services/mantencion/looker/planning-rules"
import type { PlanningRow } from "@/lib/services/mantencion/looker/types"
import { cn, formatDate, formatQty } from "@/lib/utils"
import { CrossFilterRow } from "./cross-filter-row"
import { EquipmentCell } from "./equipment-cell"

const TONE: Record<PlanningTone, string> = {
  ok: "text-[var(--color-success-ink)]",
  warn: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
  muted: "text-[var(--color-text-muted)]",
}

const NEG = Number.NEGATIVE_INFINITY

function numberText(value: number | null, unit: MantUnit): string {
  return value == null ? "—" : `${formatQty(value, undefined, { maximumFractionDigits: unit === "h" ? 1 : 0 })}`
}

/** Un valor con punto de color y texto: el estado nunca va sólo en el color. */
function ToneText({ tone, children, title }: { tone: PlanningTone; children: React.ReactNode; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", TONE[tone])} title={title}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  )
}

function Equipment({ row, selectedId, historyBase }: { row: PlanningRow; selectedId: string | null; historyBase: ReturnType<typeof parseHistoryParams> }) {
  const name = row.plate || row.code || "Equipo"
  return (
    <EquipmentCell
      plate={row.plate || row.code}
      code={row.code}
      sub={[row.code && row.code !== row.plate ? row.code : null, row.worksiteName].filter(Boolean).join(" · ")}
      href={historyHref(historyBase, { vehicleId: row.vehicleId, period: "todo" })}
      linkTitle={`Ver el historial de mantenciones de ${name}`}
      filterAction={equipmentAction(row.vehicleId, selectedId === row.vehicleId)}
    />
  )
}

function LastMaintenance({ row, unit }: { row: PlanningRow; unit: MantUnit }) {
  const every = row.frequency ?? row.base
  return (
    <>
      <span className="font-mono text-xs">{row.lastDate ? formatDate(row.lastDate) : "Sin mantención"}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-[var(--color-text-muted)]">
        {every ? <span className="font-mono">Cada {numberText(every, unit)} {unit === "km" ? "km" : "h"}</span> : null}
        {row.manual && (
          <span className="inline-flex items-center gap-1 text-[var(--color-warning-ink)]" title={row.manualReason ?? "Ajustada a mano"}>
            <PencilSimple size={11} weight="bold" aria-hidden />
            Ajustada
            <span className="sr-only">{row.manualReason ?? "a mano"}</span>
          </span>
        )}
        {row.declared && (
          <span title={row.evidence ? `Respaldo: ${row.evidence}` : "Preventiva declarada"}>Declarada</span>
        )}
      </span>
    </>
  )
}

/**
 * «Detalle por equipo»: la tabla de Planificación de la unidad de la pestaña. La patente lleva al historial del
 * equipo y el embudo de al lado lo filtra (`x_equipo`): son dos controles distintos y ninguno hace las dos cosas. El
 * clic del mouse en el resto de la fila también filtra (`CrossFilterRow`); el teclado usa el embudo. La tabla no
 * se filtra a sí misma por el equipo elegido: sigue completa y sólo resalta su fila.
 */
export function PlanningTable({
  title,
  unit,
  rows,
  selectedId,
  today,
  note,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  unit: MantUnit
  rows: PlanningRow[]
  selectedId: string | null
  /** Hoy en Chile: la base de los enlaces al historial. */
  today: string
  note: string
  emptyTitle: string
  emptyDescription: string
}) {
  const symbol = unit === "km" ? "km" : "h"
  const historyBase = parseHistoryParams({}, today)
  const columns: ColumnDef[] = [
    { key: "plate", label: "Equipo", sortable: true, width: "w-40", sortValue: (row: PlanningRow) => row.plate || row.code },
    { key: "lastDate", label: "Última mantención", sortable: true, sortValue: (row: PlanningRow) => row.lastDate ?? "" },
    { key: "programmed", label: "Tocaba a los", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.programmed ?? NEG },
    { key: "real", label: "Se hizo a los", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.real ?? NEG },
    { key: "timing", label: "¿A tiempo?", sortable: true, sortValue: (row: PlanningRow) => row.delta ?? Number.POSITIVE_INFINITY },
    { key: "current", label: "Lectura actual", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.current ?? NEG },
    { key: "next", label: "Próxima a los", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.next ?? NEG },
    { key: "remaining", label: "Faltan", numeric: true, sortable: true, sortValue: (row: PlanningRow) => row.remaining ?? Number.POSITIVE_INFINITY },
    { key: "estimated", label: "Fecha estimada", sortable: true, sortValue: (row: PlanningRow) => row.estimatedDate ?? "9999-12-31" },
    { key: "state", label: "Estado", sortable: true, sortValue: (row: PlanningRow) => row.remaining ?? Number.POSITIVE_INFINITY },
  ]

  return (
    <PanelBlock padding="none">
      <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {/* El título visible es el `h2` de la sección: aquí sólo el nombre accesible, para no repetirlo. */}
          <h3 className="sr-only">{title}</h3>
          <p className="max-w-4xl text-xs text-[var(--color-text-muted)]">{note}</p>
          <p className="text-xs tabular-nums text-[var(--color-text-muted)]">{plural(rows.length, "equipo", "equipos")}</p>
        </div>
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
          const remainingToneOf = remainingTone(row)
          const timing = timingTone(row)
          const estimate = estimateLine(row)
          const usage = usageText(row, unit)
          const state = planningStateOf(row)
          return (
            <CrossFilterRow key={row.vehicleId} action={action} active={selectedId === row.vehicleId}>
              <TableCell>
                <Equipment row={row} selectedId={selectedId} historyBase={historyBase} />
              </TableCell>
              <TableCell nowrap>
                <LastMaintenance row={row} unit={unit} />
              </TableCell>
              <TableCellNum title={row.programmed == null ? "Sin una mantención programada" : undefined}>{numberText(row.programmed, unit)}</TableCellNum>
              <TableCellNum title={row.real == null ? "Sin lectura de la última mantención" : undefined}>{numberText(row.real, unit)}</TableCellNum>
              <TableCell nowrap className="font-mono text-xs tabular-nums" title={timingDetail(row, unit) ?? "Sin datos para comparar"}>
                {row.delta == null ? <span className={TONE.muted}>—</span> : <ToneText tone={timing}>{timingText(row, unit)}</ToneText>}
              </TableCell>
              <TableCellNum className={row.current == null ? TONE.muted : undefined} title={row.current == null ? "El equipo no tiene lecturas" : undefined}>
                {row.current == null ? "Sin lectura" : numberText(row.current, unit)}
              </TableCellNum>
              <TableCellNum className={row.next == null ? TONE.muted : undefined} title={row.next == null ? "Sin pauta o sin preventiva" : undefined}>
                {row.next == null ? "Sin pauta" : numberText(row.next, unit)}
              </TableCellNum>
              <TableCellNum title={row.remaining == null ? "Sin pauta o sin lectura" : remainingText(row.remaining, unit) ?? undefined}>
                {row.remaining == null ? (
                  <span className={TONE.muted}>—</span>
                ) : (
                  <ToneText tone={remainingToneOf}>
                    {row.remaining <= 0 ? remainingText(row.remaining, unit) : `${numberText(row.remaining, unit)} ${symbol}`}
                  </ToneText>
                )}
              </TableCellNum>
              <TableCell nowrap>
                <span className={cn("font-mono text-xs tabular-nums", row.estimatedDate ? undefined : TONE.muted)} title={estimate.title}>{estimate.text}</span>
                {usage && <span className="mt-0.5 block font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{usage}</span>}
              </TableCell>
              <TableCell nowrap>
                <ToneText tone={remainingToneOf}>{PLANNING_STATE_NAME[state]}</ToneText>
              </TableCell>
            </CrossFilterRow>
          )
        }}
        renderMobileCard={(row) => {
          const estimate = estimateLine(row)
          return (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-start justify-between gap-2">
                <Equipment row={row} selectedId={selectedId} historyBase={historyBase} />
                <ToneText tone={remainingTone(row)}>{PLANNING_STATE_NAME[planningStateOf(row)]}</ToneText>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><dt className="text-[var(--color-text-muted)]">Última mantención</dt><dd className="font-mono">{row.lastDate ? formatDate(row.lastDate) : "Sin mantención"}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">¿A tiempo?</dt><dd className={cn("font-mono tabular-nums", TONE[timingTone(row)])}>{row.delta == null ? "—" : timingText(row, unit)}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Tocaba / se hizo</dt><dd className="font-mono tabular-nums">{numberText(row.programmed, unit)} / {numberText(row.real, unit)}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Actual / próxima</dt><dd className="font-mono tabular-nums">{numberText(row.current, unit)} / {numberText(row.next, unit)}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Faltan</dt><dd className={cn("font-mono tabular-nums", TONE[remainingTone(row)])}>{remainingText(row.remaining, unit) ?? "—"}</dd></div>
                <div><dt className="text-[var(--color-text-muted)]">Fecha estimada</dt><dd className="font-mono tabular-nums" title={estimate.title}>{estimate.text}</dd></div>
              </dl>
            </div>
          )
        }}
      />
    </PanelBlock>
  )
}
