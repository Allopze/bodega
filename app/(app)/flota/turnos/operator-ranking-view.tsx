"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { TableCell, TableCellNum, TableRow } from "@/components/ui/table"
import type { getOperatorRankingView } from "@/lib/services/fleet-shifts-views"
import { cn } from "@/lib/utils"
import { EquipmentFilter } from "./equipment-filter"
import { formatHoursValue } from "./format"
import { IdleBar } from "./idle-bar"

type Ranking = Awaited<ReturnType<typeof getOperatorRankingView>>["ranking"]

type Row = {
  id: string
  rank: number | null
  operatorName: string
  shifts: number
  engineHours: number
  workingHours: number
  idleHours: number
  idlePct: number | null
  overTarget: number
  pending: number
  isTotal: boolean
}

const COLUMNS = [
  { key: "rank", label: "#", sortable: false, toggleable: false },
  { key: "operatorName", label: "Operador", sortable: false },
  { key: "shifts", label: "Turnos", sortable: false, numeric: true },
  { key: "engineHours", label: "Motor h", sortable: false, numeric: true },
  { key: "workingHours", label: "Trabajo h", sortable: false, numeric: true },
  { key: "idleHours", label: "Ralentí h", sortable: false, numeric: true },
  { key: "idlePct", label: "% ralentí", sortable: false },
  { key: "overTarget", label: "Sobre meta", sortable: false, numeric: true },
  { key: "pending", label: "Pendientes", sortable: false, numeric: true },
]

/** Una cifra con un decimal; el porcentaje, como número y con la unidad aparte (`local/no-string-kpi-value`). */
function summaryStats(total: Ranking["total"], target: number): SummaryStat[] {
  const idlePct = total.idlePct
  return [
    idlePct === null
      ? { key: "ralenti", label: "% ralentí general", value: "Sin dato", valueKind: "text" }
      : {
          key: "ralenti", label: "% ralentí general", value: Math.round(idlePct * 1000) / 10, hint: "%",
          ...(idlePct > target ? { tone: "signal" as const } : {}),
        },
    { key: "turnos", label: "Turnos", value: total.shifts },
    { key: "sobre-meta", label: "Turnos sobre meta", value: total.overTarget, tone: "signal" },
    { key: "pendientes", label: "Pendientes de datos", value: total.pending },
  ]
}

/**
 * Vista «Operadores»: tira con las cifras del período y el ranking (1 = menor % de ralentí). El % de cada
 * operador y el general son ponderados por horas y sólo cuentan los turnos «En meta» o «Sobre meta»; el resto
 * se cuenta en Turnos y Pendientes sin mover el %. El orden es el del ranking: la tabla no se reordena.
 */
export function OperatorRankingView({ ranking, target, vehicleId, vehicles, dayHref }: {
  ranking: Ranking
  target: number
  vehicleId: string
  vehicles: Array<{ id: string; code: string }>
  /** Vista «Día», donde se registran los turnos: el destino del estado vacío. */
  dayHref: string
}) {
  const rows = React.useMemo<Row[]>(() => [
    ...ranking.rows.map((row) => ({ ...row, id: row.operatorWorkerId, isTotal: false })),
    ...(ranking.rows.length > 0
      ? [{ id: "__total__", rank: null, operatorName: "Total", ...ranking.total, isTotal: true }]
      : []),
  ], [ranking])
  const stats = React.useMemo(() => summaryStats(ranking.total, target), [ranking.total, target])

  return (
    <div className="space-y-4">
      <EquipmentFilter vehicleId={vehicleId} vehicles={vehicles} />
      <SummaryBar stats={stats} numerals="sans" />
      <DataTable
        caption="Ranking de operadores por % de ralentí"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["operatorName"]}
        disableInternalSearch
        disableSort
        hideDensityToggle
        pageSize={1000}
        getRowKey={(row) => row.id}
        tableClassName="min-w-[900px]"
        emptyTitle="No hay turnos en este período"
        emptyDescription="Cuando se registren turnos de operación, aquí verás el ranking de operadores por % de ralentí."
        emptyAction={<Button asChild variant="secondary"><Link href={dayHref}>Ir a los turnos del día</Link></Button>}
        renderMobileCard={(row) => (
          <article className={cn(
            "rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]",
            row.isTotal && "bg-[var(--color-surface-2)]",
          )}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">{row.rank !== null && <span className="mr-2 font-mono tabular-nums text-[var(--color-text-muted)]">{row.rank}</span>}{row.operatorName}</p>
              <IdleBar pct={row.idlePct} target={target} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-[var(--color-text-subtle)]">Turnos</dt><dd className="font-mono tabular-nums">{row.shifts}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Motor</dt><dd className="font-mono tabular-nums">{formatHoursValue(row.engineHours)} h</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Trabajo</dt><dd className="font-mono tabular-nums">{formatHoursValue(row.workingHours)} h</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Ralentí</dt><dd className="font-mono tabular-nums">{formatHoursValue(row.idleHours)} h</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Sobre meta</dt><dd className="font-mono tabular-nums">{row.overTarget}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Pendientes</dt><dd className="font-mono tabular-nums">{row.pending}</dd></div>
            </dl>
          </article>
        )}
        renderRow={(row) => (
          <TableRow key={row.id} className={row.isTotal ? "bg-[var(--color-surface-2)] font-semibold" : undefined}>
            <TableCellNum className="w-12 text-left">{row.rank ?? "—"}</TableCellNum>
            <TableCell>{row.operatorName}</TableCell>
            <TableCellNum>{row.shifts}</TableCellNum>
            <TableCellNum>{formatHoursValue(row.engineHours)}</TableCellNum>
            <TableCellNum>{formatHoursValue(row.workingHours)}</TableCellNum>
            <TableCellNum>{formatHoursValue(row.idleHours)}</TableCellNum>
            <TableCell><IdleBar pct={row.idlePct} target={target} /></TableCell>
            <TableCellNum>{row.overTarget}</TableCellNum>
            <TableCellNum>{row.pending}</TableCellNum>
          </TableRow>
        )}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Ranking: 1 = menor % de ralentí. % ralentí = ralentí ÷ (trabajo + ralentí), ponderado por horas. Los turnos sin telemetría o con menos de 0,5 h de motor no cuentan.
      </p>
    </div>
  )
}
