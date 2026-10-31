"use client"

import * as React from "react"
import Link from "next/link"
import { Camera, ClockCounterClockwise, GearSix, Truck } from "@phosphor-icons/react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ReviewRequestControl } from "@/components/combustibles/load-detail/review-request-control"
import { FUEL_LOAD_ORIGIN_LABEL, PERSONAL_DATA_LABEL, fuelLogPending, type FuelLogRow } from "@/lib/combustibles/fuel-log-shared"
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state"
import { formatDateTime } from "@/lib/utils"

/** Enlaces ya armados por la página (con el período y la faena de la pantalla): la tabla no construye URL. */
export interface CargaRowHrefs {
  /** Ficha de la carga. */
  detail: string
  /** Ficha del equipo; `null` cuando la patente no está vinculada. */
  equipment: string | null
  /** Historial de la carga; `null` sin `view_audit`. */
  history: string | null
  /** Fotos de la carga (ancla de la ficha); `null` sin `view_personal` o sin fotos. */
  evidence: string | null
  /** La carga en la bandeja «Por revisar»; `null` si no está por decidir. */
  decide: string | null
  /** El pedido de revisión en la bandeja. */
  requested: string
  /** Los casos de anomalía en la bandeja. */
  cases: string
}

export type EnrichedRow = FuelLogRow & { hrefs: CargaRowHrefs }

type PendingKind = ReturnType<typeof fuelLogPending>[number]["kind"]

interface ColumnDef {
  key: string
  label: string
  defaultVisible: boolean
  /** `canViewPersonal`: la sesión tiene `combustibles:view_personal`. El servidor ya enmascaró el dato; esto solo rotula el vacío. */
  render: (row: EnrichedRow, canViewPersonal: boolean) => React.ReactNode
  numeric?: boolean
}

function personalCell(value: string | null, canViewPersonal: boolean): React.ReactNode {
  if (!canViewPersonal) {
    return <span className="text-[var(--color-text-muted)]" title="Requiere el permiso para ver datos personales">{PERSONAL_DATA_LABEL}</span>
  }
  return value ?? "—"
}

/** Unidad del medidor según cómo lo rotula cada origen («Odómetro», «Horómetro», «Medidor (km)»). */
function meterUnit(label: string | null): string {
  if (!label) return ""
  const text = label.toLowerCase()
  if (text.includes("odómetro") || text.includes("(km)")) return "km"
  if (text.includes("horómetro") || text.includes("(hora)")) return "h"
  return ""
}

function PendingCell({ row }: { row: EnrichedRow }) {
  const pending = fuelLogPending(row)
  if (pending.length === 0) return <span className="text-[var(--color-text-subtle)]">—</span>
  const hrefFor = (kind: PendingKind) => (kind === "decide" ? row.hrefs.decide : kind === "requested" ? row.hrefs.requested : kind === "case" ? row.hrefs.cases : row.hrefs.detail)
  return (
    <span className="flex flex-wrap gap-1">
      {pending.map((item) => {
        const href = hrefFor(item.kind)
        // Un motivo largo («Rendimiento fuera de rango físico») se parte en dos líneas: en la tarjeta del
        // celular la columna mide la mitad del ancho y el badge, que no corta por defecto, se salía de ella.
        const badge = <MetaBadge meta={{ label: item.label, variant: "signal" }} size="sm" className="max-w-full whitespace-normal text-left" />
        return href ? <Link key={item.kind} href={href} className="max-w-full rounded-full focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">{badge}</Link> : <span key={item.kind} className="max-w-full">{badge}</span>
      })}
    </span>
  )
}

function StateCell({ row }: { row: EnrichedRow }) {
  // La planilla no tiene un estado propio: llega importada y se queda así.
  if (row.source === "operation_manual") return <Badge variant="default" size="sm">Importada</Badge>
  return row.statusLabel ? <StateBadge state={row.statusLabel} entity="fuel_log" size="sm" /> : <>—</>
}

function EquipmentCell({ row }: { row: EnrichedRow }) {
  const code = row.equipmentCode ?? row.plate ?? "Equipo sin identificar"
  const detail = [row.equipmentTypeName, row.plate && row.equipmentCode ? row.plate : null].filter(Boolean).join(" · ")
  return (
    <span className="flex flex-col">
      <Link href={row.hrefs.detail} className="font-medium text-[var(--color-primary-ink)] hover:underline" aria-label={`Abrir la carga de ${code}`}>{code}</Link>
      {detail ? <span className="text-xs text-[var(--color-text-subtle)]">{detail}</span> : null}
    </span>
  )
}

const COLUMNS: ColumnDef[] = [
  { key: "occurredAt", label: "Fecha y hora", defaultVisible: true, render: (r) => <span className="font-mono text-xs tabular-nums">{formatDateTime(r.occurredAt)}</span> },
  { key: "equipment", label: "Equipo", defaultVisible: true, render: (r) => <EquipmentCell row={r} /> },
  { key: "worksiteName", label: "Faena", defaultVisible: true, render: (r) => r.worksiteName ?? "—" },
  { key: "liters", label: "Litros", defaultVisible: true, numeric: true, render: (r) => `${Number(r.liters).toLocaleString("es-CL")} L` },
  {
    key: "meterReading", label: "Lectura", defaultVisible: true, numeric: true,
    render: (r) => r.meterReading == null
      ? "—"
      : <span>{Number(r.meterReading).toLocaleString("es-CL")}<span className="ml-1 text-[var(--color-text-muted)]">{meterUnit(r.meterLabel)}</span></span>,
  },
  { key: "origin", label: "Cómo llegó", defaultVisible: true, render: (r) => <Badge variant="outline" size="sm">{FUEL_LOAD_ORIGIN_LABEL[r.origin]}</Badge> },
  { key: "statusLabel", label: "Estado", defaultVisible: true, render: (r) => <StateCell row={r} /> },
  { key: "pending", label: "Pendiente", defaultVisible: true, render: (r) => <PendingCell row={r} /> },
  { key: "equipmentTypeName", label: "Tipo de equipo", defaultVisible: false, render: (r) => r.equipmentTypeName ?? "—" },
  { key: "driverName", label: "Conductor", defaultVisible: false, render: (r, personal) => personalCell(r.driverName, personal) },
  { key: "supervisorName", label: "Supervisor", defaultVisible: false, render: (r, personal) => personalCell(r.supervisorName, personal) },
  { key: "supplierName", label: "Proveedor", defaultVisible: false, render: (r) => r.supplierName ?? "—" },
  { key: "loadingPointName", label: "Lugar de carga", defaultVisible: false, render: (r) => r.loadingPointName ?? "—" },
  { key: "productName", label: "Combustible", defaultVisible: false, render: (r) => r.productName ?? "—" },
  { key: "performance", label: "Rendimiento", defaultVisible: false, numeric: true, render: (r) => r.performanceValue == null ? "—" : <span>{Number(r.performanceValue).toLocaleString("es-CL")}<span className="ml-1 text-[var(--color-text-muted)]">{r.performanceUnit === "km_lt" ? "km/L" : r.performanceUnit === "lt_hr" ? "L/h" : ""}</span></span> },
  { key: "seals", label: "Sellos", defaultVisible: false, render: (r) => (r.sealRemoved || r.sealInstalled) ? `${r.sealRemoved ?? "—"} → ${r.sealInstalled ?? "—"}` : "—" },
  { key: "evidenceCount", label: "Fotos", defaultVisible: false, numeric: true, render: (r) => r.evidenceCount == null ? "—" : `${r.evidenceCount} de 4` },
  { key: "notes", label: "Observaciones", defaultVisible: false, render: (r) => <span className="line-clamp-2 max-w-[220px]">{r.notes ?? "—"}</span> },
  { key: "createdByName", label: "Creado por", defaultVisible: false, render: (r) => r.createdByName ?? "—" },
  { key: "updatedByName", label: "Modificado por", defaultVisible: false, render: (r) => r.updatedByName ?? "—" },
  { key: "createdAt", label: "Creado", defaultVisible: false, render: (r) => r.createdAt ? formatDateTime(r.createdAt) : "—" },
  { key: "updatedAt", label: "Modificado", defaultVisible: false, render: (r) => r.updatedAt ? formatDateTime(r.updatedAt) : "—" },
]

const DEFAULT_COLUMN_KEYS = COLUMNS.filter((column) => column.defaultVisible).map((column) => column.key)
const COLUMNS_STORAGE_KEY = "chome:combustibles:cargas:columnas"
const VALID_COLUMN_KEYS = new Set(COLUMNS.map((column) => column.key))

function parseColumnKeys(stored: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return null
    const keys = parsed.filter((key): key is string => typeof key === "string" && VALID_COLUMN_KEYS.has(key))
    return keys.length > 0 ? keys : null
  } catch {
    return null
  }
}

const serializeColumnKeys = (keys: string[]) => JSON.stringify(keys)

export const rowKey = (row: Pick<FuelLogRow, "source" | "id">) => `${row.source}:${row.id}`

/**
 * La tabla de «Cargas a equipos». El selector de columnas recuerda la elección
 * de la persona; la selección de filas vive en quien la usa (el cabezal de la
 * pantalla, que muestra «Exportar (N seleccionadas)»). Bajo `md` las filas se
 * muestran como tarjetas, con lo que decide: equipo, estado, lo pendiente y la
 * acción de abrir.
 */
export function BitacoraTable({
  rows,
  canViewPersonal,
  selectedKeys,
  onSelectedKeysChange,
  currentUserId,
  canWithdrawOthers = false,
  initialColumnKeys,
}: {
  rows: EnrichedRow[]
  canViewPersonal: boolean
  selectedKeys?: ReadonlySet<string>
  onSelectedKeysChange?: (next: Set<string>) => void
  /** Quien mira la tabla: puede retirar el pedido de revisión que pidió. */
  currentUserId?: string
  /** `approve_flagged` o `tae_review`: puede retirar pedidos de otras personas. */
  canWithdrawOthers?: boolean
  /** Sólo para pruebas: columnas iniciales sin leer lo guardado. */
  initialColumnKeys?: string[]
}) {
  const [storedKeys, setStoredKeys] = useLocalStorageState<string[]>(COLUMNS_STORAGE_KEY, initialColumnKeys ?? DEFAULT_COLUMN_KEYS, parseColumnKeys, serializeColumnKeys)
  const visible = new Set(storedKeys)
  const columns = COLUMNS.filter((column) => visible.has(column.key))
  const selectable = Boolean(onSelectedKeysChange)
  const selected = selectedKeys ?? new Set<string>()
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(rowKey(row)))

  function toggleColumn(key: string) {
    const next = new Set(visible)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // El orden es el del catálogo, no el del clic.
    setStoredKeys(COLUMNS.filter((column) => next.has(column.key)).map((column) => column.key))
  }

  function toggleRow(key: string) {
    if (!onSelectedKeysChange) return
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedKeysChange(next)
  }

  function toggleAll() {
    if (!onSelectedKeysChange) return
    onSelectedKeysChange(allSelected ? new Set() : new Set(rows.map(rowKey)))
  }

  const canWithdraw = (row: EnrichedRow) => Boolean(row.reviewMark && (row.reviewMarkedBy === currentUserId || canWithdrawOthers))
  const requestSummary = (row: EnrichedRow) => row.reviewMark ? { id: row.reviewMarkId ?? "", note: row.reviewMarkNotes, markedByName: null } : null
  const label = (row: EnrichedRow) => row.equipmentCode ?? row.plate ?? "equipo sin identificar"

  return (
    <div>
      <div className="mb-2 hidden items-center justify-between gap-2 md:flex">
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
      </div>

      {/* Escritorio: la tabla. */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-2xl)] border border-[var(--color-border)] md:block">
        <Table className="min-w-[1000px] text-sm">
          <TableHeader>
            <TableRow>
              {selectable && <TableHead className="w-10"><Checkbox id="select-all" label="Seleccionar todas las filas" labelHidden checked={allSelected} onChange={toggleAll} /></TableHead>}
              {columns.map((column) => <TableHead key={column.key} className={column.numeric ? "text-right" : ""}>{column.label}</TableHead>)}
              <TableHead className="w-36">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + (selectable ? 2 : 1)} className="py-10 text-center text-[var(--color-text-muted)]">Sin cargas para este filtro.</TableCell></TableRow>}
            {rows.map((row) => {
              const key = rowKey(row)
              return (
                <TableRow key={key}>
                  {selectable && <TableCell><Checkbox id={`select-${key}`} label={`Seleccionar la carga de ${label(row)}`} labelHidden checked={selected.has(key)} onChange={() => toggleRow(key)} /></TableCell>}
                  {columns.map((column) => <TableCell key={column.key} className={column.numeric ? "text-right font-mono tabular-nums" : ""}>{column.render(row, canViewPersonal)}</TableCell>)}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <ReviewRequestControl source={row.source} entityId={row.id} openRequest={requestSummary(row)} canWithdraw={canWithdraw(row)} variant="icon" equipmentLabel={label(row)} />
                      {row.hrefs.equipment && (
                        <Link href={row.hrefs.equipment} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--color-primary-ink)] hover:bg-[var(--color-surface-2)]" aria-label={`Ver la ficha del equipo ${label(row)}`} title="Ficha del equipo"><Truck size={14} aria-hidden /></Link>
                      )}
                      {row.hrefs.evidence && (
                        <Link href={row.hrefs.evidence} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--color-primary-ink)] hover:bg-[var(--color-surface-2)]" aria-label={`Ver las fotos de la carga de ${label(row)}`} title="Ver fotos"><Camera size={14} aria-hidden /></Link>
                      )}
                      {row.hrefs.history && (
                        <Link href={row.hrefs.history} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--color-primary-ink)] hover:bg-[var(--color-surface-2)]" aria-label={`Ver el historial de la carga de ${label(row)}`} title="Historial de cambios"><ClockCounterClockwise size={14} aria-hidden /></Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Celular: una tarjeta por carga. */}
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Sin cargas para este filtro.</p>}
        {rows.map((row) => (
          <ResponsiveDataListCard
            key={`card:${rowKey(row)}`}
            title={<Link href={row.hrefs.detail}>{row.equipmentCode ?? row.plate ?? "Equipo sin identificar"}</Link>}
            description={`${formatDateTime(row.occurredAt)} · ${row.worksiteName ?? "Sin faena"}`}
            status={<StateCell row={row} />}
            actions={
              <>
                <ReviewRequestControl source={row.source} entityId={row.id} openRequest={requestSummary(row)} canWithdraw={canWithdraw(row)} variant="icon" equipmentLabel={label(row)} />
                <Button asChild size="sm" variant="secondary"><Link href={row.hrefs.detail}>Abrir</Link></Button>
              </>
            }
          >
            <ResponsiveDataListField label="Litros"><span className="font-mono tabular-nums">{Number(row.liters).toLocaleString("es-CL")} L</span></ResponsiveDataListField>
            <ResponsiveDataListField label="Lectura">{row.meterReading == null ? "—" : <span className="font-mono tabular-nums">{Number(row.meterReading).toLocaleString("es-CL")} {meterUnit(row.meterLabel)}</span>}</ResponsiveDataListField>
            <ResponsiveDataListField label="Cómo llegó">{FUEL_LOAD_ORIGIN_LABEL[row.origin]}</ResponsiveDataListField>
            <ResponsiveDataListField label="Pendiente"><PendingCell row={row} /></ResponsiveDataListField>
          </ResponsiveDataListCard>
        ))}
      </div>
    </div>
  )
}
