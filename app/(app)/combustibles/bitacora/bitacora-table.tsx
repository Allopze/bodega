"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowSquareOut, Camera, ClockCounterClockwise, Flag, GearSix } from "@phosphor-icons/react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CrossFilterCell } from "@/components/ui/cross-filter-cell"
import { FUEL_LOG_SOURCE_LABEL, type FuelLogRow, type FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { formatDateTime } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { BitacoraSelectionExport } from "./export-button"
import { toggleReviewMarkAction } from "./actions"

type EnrichedRow = FuelLogRow & { detailHref: string; auditEntity: { entityType: string; entityId: string } | null }

const SOURCE_BADGE: Record<FuelLogSource, "primary" | "info" | "default"> = {
  tae_pwa: "primary",
  invoiced: "info",
  operation_manual: "default",
}

interface ColumnDef {
  key: string
  label: string
  defaultVisible: boolean
  render: (row: EnrichedRow) => React.ReactNode
  numeric?: boolean
}

const COLUMNS: ColumnDef[] = [
  { key: "occurredAt", label: "Fecha y hora", defaultVisible: true, render: (r) => <span className="font-mono text-xs">{formatDateTime(r.occurredAt)}</span> },
  { key: "source", label: "Fuente", defaultVisible: true, render: (r) => <Badge variant={SOURCE_BADGE[r.source]} size="sm">{FUEL_LOG_SOURCE_LABEL[r.source]}</Badge> },
  { key: "worksiteName", label: "Faena", defaultVisible: true, render: (r) => r.worksiteName ?? "—" },
  {
    key: "equipment", label: "Equipo", defaultVisible: true,
    render: (r) => r.plate
      ? <CrossFilterCell value={`${r.equipmentCode ?? "—"} · ${r.plate}`} paramKey="q" paramValue={r.plate} />
      : <span>{r.equipmentCode ?? "—"}</span>,
  },
  {
    key: "equipmentTypeName", label: "Tipo de equipo", defaultVisible: false,
    render: (r) => r.equipmentTypeId
      ? <CrossFilterCell value={r.equipmentTypeName} paramKey="tipo" paramValue={r.equipmentTypeId} />
      : (r.equipmentTypeName ?? "—"),
  },
  { key: "driverName", label: "Conductor", defaultVisible: true, render: (r) => r.driverName ?? "—" },
  { key: "supervisorName", label: "Supervisor", defaultVisible: true, render: (r) => r.supervisorName ?? "—" },
  {
    key: "supplierName", label: "Proveedor", defaultVisible: false,
    render: (r) => r.supplierId
      ? <CrossFilterCell value={r.supplierName} paramKey="proveedor" paramValue={r.supplierId} />
      : (r.supplierName ?? "—"),
  },
  { key: "loadingPointName", label: "Lugar de carga", defaultVisible: false, render: (r) => r.loadingPointName ?? "—" },
  { key: "productName", label: "Producto", defaultVisible: true, render: (r) => r.productName ?? "—" },
  { key: "liters", label: "Litros", defaultVisible: true, numeric: true, render: (r) => `${Number(r.liters).toLocaleString("es-CL")} L` },
  { key: "meterReading", label: "Medidor", defaultVisible: false, render: (r) => r.meterReading == null ? "—" : <span>{Number(r.meterReading).toLocaleString("es-CL")}<span className="ml-1 text-[var(--color-text-muted)]">{r.meterLabel ?? ""}</span></span> },
  { key: "performance", label: "Rendimiento", defaultVisible: false, render: (r) => r.performanceValue == null ? "—" : <span>{Number(r.performanceValue).toLocaleString("es-CL")}<span className="ml-1 text-[var(--color-text-muted)]">{r.performanceUnit === "km_lt" ? "km/L" : r.performanceUnit === "lt_hr" ? "L/h" : ""}</span></span> },
  { key: "seals", label: "Sellos", defaultVisible: false, render: (r) => (r.sealRemoved || r.sealInstalled) ? `${r.sealRemoved ?? "—"} → ${r.sealInstalled ?? "—"}` : "—" },
  { key: "evidenceCount", label: "Evidencias", defaultVisible: false, render: (r) => r.evidenceCount == null ? "—" : `${r.evidenceCount}/4` },
  { key: "notes", label: "Observaciones", defaultVisible: false, render: (r) => <span className="line-clamp-2 max-w-[220px]">{r.notes ?? "—"}</span> },
  { key: "statusLabel", label: "Estado", defaultVisible: true, render: (r) => r.statusLabel ? <StateBadge state={r.statusLabel} entity="fuel_log" size="sm" /> : "—" },
  { key: "createdByName", label: "Creado por", defaultVisible: false, render: (r) => r.createdByName ?? "—" },
  { key: "updatedByName", label: "Modificado por", defaultVisible: false, render: (r) => r.updatedByName ?? "—" },
  { key: "anomalyCount", label: "Anomalías", defaultVisible: true, render: (r) => r.anomalyCount != null && r.anomalyCount > 0 ? <Link href={`/combustibles/anomalias?ref=${r.source}:${r.id}`}><Badge variant="danger" size="sm">{r.anomalyCount}</Badge></Link> : <span className="text-[var(--color-text-muted)]">—</span> },
  { key: "reviewMark", label: "Revisión", defaultVisible: true, render: (r) => r.reviewMark ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={r.reviewMarkNotes ?? "Marcado para revisión"}><Flag size={14} weight="fill" />{r.reviewMarkNotes ? <span className="text-xs max-w-[120px] truncate">{r.reviewMarkNotes}</span> : null}</span> : null },
  { key: "createdAt", label: "Creado", defaultVisible: false, render: (r) => r.createdAt ? formatDateTime(r.createdAt) : "—" },
  { key: "updatedAt", label: "Modificado", defaultVisible: false, render: (r) => r.updatedAt ? formatDateTime(r.updatedAt) : "—" },
]

/** Botón de toggle para marcar/desmarcar una fila para revisión. */
function ReviewToggle({ row }: { row: EnrichedRow }) {
  const [busy, setBusy] = React.useState(false)
  const [marked, setMarked] = React.useState(row.reviewMark)

  async function handleClick() {
    setBusy(true)
    try {
      const res = await toggleReviewMarkAction(row.source, row.id)
      if (res.ok) {
        setMarked(res.marked)
        toast.success(res.marked ? "Marcado para revisión" : "Marca de revisión eliminada")
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error("Error al cambiar marca de revisión")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 text-xs transition-colors hover:opacity-80 ${marked ? "text-amber-600 dark:text-amber-400" : "text-[var(--color-text-muted)] hover:text-amber-600 dark:hover:text-amber-400"}`}
      // `title` era el único nombre de un botón que sólo muestra un icono: el
      // más débil de la cadena de nombres accesibles, y nulo al tacto.
      aria-label={marked ? "Quitar marca de revisión" : "Marcar para revisión"}
      aria-pressed={Boolean(marked)}
    >
      <Flag size={14} weight={marked ? "fill" : "regular"} />
    </button>
  )
}

const rowKey = (row: EnrichedRow) => `${row.source}:${row.id}`

export function BitacoraTable({ rows }: { rows: EnrichedRow[] }) {
  const [visible, setVisible] = React.useState<Set<string>>(() => new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)))
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const columns = COLUMNS.filter((c) => visible.has(c.key))
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(rowKey(row)))

  function toggleColumn(key: string) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(rowKey)))
  }

  const selection = rows.filter((row) => selected.has(rowKey(row))).map((row) => ({ source: row.source, id: row.id }))

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm"><GearSix size={14} className="mr-1" />Columnas</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto p-2">
            <div className="space-y-1.5">
              {COLUMNS.map((column) => (
                <Checkbox key={column.key} id={`col-${column.key}`} label={column.label} checked={visible.has(column.key)} onChange={() => toggleColumn(column.key)} />
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        {selection.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span>{selection.length} seleccionadas</span>
            <BitacoraSelectionExport selection={selection} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto border border-[var(--color-border)]">
        <Table className="min-w-[1100px] text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox id="select-all" label="" checked={allSelected} onChange={toggleAll} aria-label="Seleccionar todas las filas" /></TableHead>
              {columns.map((column) => <TableHead key={column.key} className={column.numeric ? "text-right" : ""}>{column.label}</TableHead>)}
              <TableHead className="w-28">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 2} className="py-10 text-center text-[var(--color-text-muted)]">Sin registros para este filtro.</TableCell></TableRow>}
            {rows.map((row) => {
              const key = rowKey(row)
              return (
                <TableRow key={key} className={row.reviewMark ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                  <TableCell><Checkbox id={`select-${key}`} label="" checked={selected.has(key)} onChange={() => toggleRow(key)} aria-label={`Seleccionar fila ${key}`} /></TableCell>
                  {columns.map((column) => <TableCell key={column.key} className={column.numeric ? "text-right font-mono" : ""}>{column.render(row)}</TableCell>)}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <ReviewToggle row={row} />
                      <Link href={row.detailHref} className="inline-flex items-center gap-1 text-xs text-[var(--color-primary-ink)] hover:underline" title="Abrir detalle"><ArrowSquareOut size={14} /></Link>
                      {row.source === "tae_pwa" && (row.evidenceCount ?? 0) > 0 && (
                        <Link href={`${row.detailHref}#evidencia`} className="inline-flex items-center gap-1 text-xs text-[var(--color-primary-ink)] hover:underline" title="Ver evidencias"><Camera size={14} /></Link>
                      )}
                      {row.auditEntity && (
                        <Link href={`/combustibles/bitacora/historial/${row.auditEntity.entityType}/${row.auditEntity.entityId}`} className="inline-flex items-center gap-1 text-xs text-[var(--color-primary-ink)] hover:underline" title="Historial de cambios"><ClockCounterClockwise size={14} /></Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
