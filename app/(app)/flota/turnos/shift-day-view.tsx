"use client"

import * as React from "react"
import { Warning } from "@phosphor-icons/react"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DataTable } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, Table, TableRow } from "@/components/ui/table"
import { SHIFT_STATUS_LABEL } from "@/lib/fleet/shifts/calc"
import { OTHER_SHIFT_LABEL } from "@/lib/fleet/shifts/constants"
import { useOperation } from "@/lib/hooks/use-operation"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import { toast } from "@/lib/toast"
import type { EquipmentDayRow, ShiftRow } from "@/lib/services/fleet-shifts-views"
import { voidShiftAction } from "./actions"
import { DAY_MARK_LABEL, DayMarkControl } from "./day-mark-control"
import { formatHoursValue, shiftRangeLabel } from "./format"
import { IdleBar } from "./idle-bar"
import { ShiftForm, useShiftFormOpenPreference, type ShiftFormOperator, type ShiftFormVehicle } from "./shift-form"
import { ShiftStatusBadge } from "./shift-status-badge"

// Un tipo (no la interfaz) para que sea asignable al `Record<string, unknown>` de DataTable; `search` no se usa
// (la ruta oculta la búsqueda de la barra superior) pero DataTable exige una clave de búsqueda.
type Row = { [K in keyof ShiftRow]: ShiftRow[K] } & { search: string }

const SHIFT_COLUMNS = [
  { key: "vehicleCode", label: "Equipo", sortable: true },
  { key: "turno", label: "Turno", sortable: true, sortValue: (row: Row) => row.startHour },
  { key: "operatorName", label: "Operador", sortable: true },
  { key: "schedule", label: "Horario", sortable: false },
  { key: "engineHours", label: "Motor h", sortable: true, numeric: true, sortValue: (row: Row) => row.summary.engineHours },
  { key: "workingHours", label: "Trabajo h", sortable: true, numeric: true, sortValue: (row: Row) => row.summary.workingHours },
  { key: "idleHours", label: "Ralentí h", sortable: true, numeric: true, sortValue: (row: Row) => row.summary.idleHours },
  { key: "idlePct", label: "% ralentí", sortable: true, sortValue: (row: Row) => row.summary.idlePct },
  { key: "status", label: "Estado", sortable: true, sortValue: (row: Row) => SHIFT_STATUS_LABEL[row.summary.status] },
  { key: "_actions", label: "Acciones", sortable: false, toggleable: false },
]

function turnoLabel(row: ShiftRow): string {
  return row.presetLabel ?? OTHER_SHIFT_LABEL
}

/** Los números de un turno sin telemetría no existen: «—» en vez de ceros que parecen medidas. */
/** Horas de un turno: sin telemetría o con horas aún sin llegar no hay cifra (una parcial se leería como final). */
function hoursCell(row: ShiftRow, value: number): string {
  return row.summary.status === "sin_telemetria" || row.summary.status === "pendiente" ? "—" : formatHoursValue(value)
}

/**
 * % de ralentí de un turno: sólo cuando el turno cuenta (en meta o sobre meta). Uno pendiente mostraría un %
 * parcial con la barra en el color de «en meta», y uno sin uso, un % de minutos sueltos que no entra al ranking.
 */
function shiftIdlePct(row: ShiftRow): number | null {
  return row.summary.status === "en_meta" || row.summary.status === "sobre_meta" ? row.summary.idlePct : null
}

/** Ralentí del equipo en el día completo: una barra, o el motivo de que no haya cifra. */
function DayIdleCell({ row, target }: { row: EquipmentDayRow; target: number }) {
  switch (row.summary.signal) {
    case "sin_telemetria": return <span className="text-xs text-[var(--color-text-muted)]">Sin VisionLink</span>
    case "pendiente": return <Badge variant="info" title="Alguna hora del día aún no llega de VisionLink.">Pendiente de datos</Badge>
    case "sin_senal": return <Badge variant="warning" title="El equipo no transmite desde antes de ese día.">Sin señal</Badge>
    default:
      // Con motor y sin % (ConnectPro sólo informa tramos «running»): decirlo, no dibujar «—» como si estuviera detenido.
      if (row.summary.engineHours > 0 && row.summary.idlePct === null) {
        return <span className="text-xs text-[var(--color-text-muted)]" title="El equipo no distingue ralentí de trabajo.">Sin dato de ralentí</span>
      }
      return <IdleBar pct={row.summary.idlePct} target={target} />
  }
}

function EquipmentDayTable({ vehicles, day, target, canManage }: {
  vehicles: EquipmentDayRow[]
  day: string
  target: number
  canManage: boolean
}) {
  return (
    <TableRoot aria-label="Equipos del día, con su ralentí de 00 a 24 h">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <TableHead>Equipo</TableHead>
            <TableHead>Ralentí del día</TableHead>
            <TableHead className="text-right">Motor h</TableHead>
            <TableHead>Turnos</TableHead>
            <TableHead>Estado del equipo</TableHead>
            <TableHead>Marca del día</TableHead>
            {canManage && <TableHead><span className="sr-only">Acciones</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.map((row) => (
            <TableRow key={row.vehicleId}>
              <TableCell><VehicleIdentity code={row.vehicleCode} href={vehicleFichaHref(row.vehicleId)} /></TableCell>
              <TableCell><DayIdleCell row={row} target={target} /></TableCell>
              <TableCellNum>{row.hasVisionLink ? formatHoursValue(row.summary.engineHours) : "—"}</TableCellNum>
              <TableCell>
                <span className="tabular-nums">{row.shiftsCount}</span>
                {row.summary.warnUnassigned && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-warning-ink)]">
                    <Warning size={12} weight="bold" aria-hidden="true" />
                    {formatHoursValue(row.summary.unassignedEngineHours)} h de motor sin turno
                  </span>
                )}
              </TableCell>
              <TableCell><StateBadge state={row.operationalStatus} entity="fleet" /></TableCell>
              <TableCell>
                {row.dayMark
                  ? <Badge variant="outline" title={row.dayMark.notes || undefined}>{DAY_MARK_LABEL[row.dayMark.reason] ?? row.dayMark.reason}</Badge>
                  : <span className="text-[var(--color-text-subtle)]">—</span>}
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  <DayMarkControl vehicleId={row.vehicleId} vehicleCode={row.vehicleCode} day={day} mark={row.dayMark} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}

/**
 * Vista «Día»: cómo estuvo cada equipo (00 a 24 h), el formulario de turno —en línea y plegable— y la tabla
 * de los turnos del día. Anular pide el motivo; guardar no pide confirmación.
 */
export function ShiftDayView({ day, target, vehicles, shifts, formVehicles, formOperators, canManage }: {
  day: string
  target: number
  vehicles: EquipmentDayRow[]
  shifts: ShiftRow[]
  formVehicles: ShiftFormVehicle[]
  formOperators: ShiftFormOperator[]
  canManage: boolean
}) {
  const [editing, setEditing] = React.useState<ShiftRow | null>(null)
  const [voiding, setVoiding] = React.useState<ShiftRow | null>(null)
  const [formOpen, setFormOpen] = useShiftFormOpenPreference()
  const formRef = React.useRef<HTMLDivElement>(null)
  const voidOp = useOperation()

  const data = React.useMemo<Row[]>(() => shifts.map((shift) => ({
    ...shift,
    search: `${shift.vehicleCode} ${shift.operatorName} ${turnoLabel(shift)}`,
  })), [shifts])

  function openForm(row: ShiftRow | null) {
    setEditing(row)
    setFormOpen(true)
    // Después de pintar: el formulario recién abierto o recién cargado con el turno.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
      if (!row) document.getElementById("shift-vehicle")?.focus()
    })
  }

  function confirmVoid(reason: string) {
    if (!voiding) return
    voidOp.run(
      () => voidShiftAction(voiding.id, reason),
      () => { toast.success("Turno anulado."); setVoiding(null); if (editing?.id === voiding.id) setEditing(null) },
    )
  }

  const rowActions = (row: ShiftRow, className?: string) => canManage ? (
    <div className={className ?? "flex justify-end gap-2"}>
      <Button size="sm" variant="secondary" aria-label={`Editar turno de ${row.vehicleCode}, ${row.operatorName}`} onClick={() => openForm(row)}>Editar</Button>
      <Button size="sm" variant="secondary" aria-label={`Anular turno de ${row.vehicleCode}, ${row.operatorName}`} onClick={() => { voidOp.setMessage(""); setVoiding(row) }}>Anular</Button>
    </div>
  ) : null

  return (
    <div className="space-y-6">
      <section aria-label="Equipos del día" className="space-y-2">
        {vehicles.length > 0 ? (
          <EquipmentDayTable vehicles={vehicles} day={day} target={target} canManage={canManage} />
        ) : (
          <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <EmptyState
              compact
              title="No hay equipos que mostrar este día"
              description="Aquí aparecen los equipos con VisionLink de tus faenas y los que tengan turnos o marcas ese día."
              action={canManage ? <Button type="button" onClick={() => openForm(null)}>Registrar turno</Button> : undefined}
            />
          </div>
        )}
      </section>

      {canManage && (
        <div ref={formRef} className="scroll-mt-4">
          <ShiftForm
            key={editing?.id ?? "nuevo"}
            day={day}
            vehicles={formVehicles}
            operators={formOperators}
            editing={editing}
            open={formOpen}
            onOpenChange={setFormOpen}
            onEditDone={() => setEditing(null)}
          />
        </div>
      )}

      <section aria-label="Turnos del día">
        <DataTable
          caption="Turnos registrados del día"
          columns={SHIFT_COLUMNS}
          rows={data}
          searchKeys={["search"]}
          disableInternalSearch
          hideDensityToggle
          tableClassName="min-w-[1040px]"
          emptyTitle="No hay turnos registrados para este día."
          emptyDescription="Registra el turno de cada equipo para ver su ralentí por operador."
          emptyAction={canManage ? <Button type="button" onClick={() => openForm(null)}>Registrar turno</Button> : undefined}
          renderMobileCard={(row) => (
            <article className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-medium">{row.vehicleCode}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{turnoLabel(row)} · {row.operatorName}</p>
                </div>
                <ShiftStatusBadge status={row.summary.status} />
              </div>
              <div className="mt-3"><IdleBar pct={shiftIdlePct(row)} target={target} /></div>
              <dl className="mt-3 grid grid-cols-3 gap-x-3 text-xs">
                <div><dt className="text-[var(--color-text-subtle)]">Motor</dt><dd className="font-mono tabular-nums">{hoursCell(row, row.summary.engineHours)} h</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Trabajo</dt><dd className="font-mono tabular-nums">{hoursCell(row, row.summary.workingHours)} h</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Ralentí</dt><dd className="font-mono tabular-nums">{hoursCell(row, row.summary.idleHours)} h</dd></div>
              </dl>
              {rowActions(row, "mt-3 grid grid-cols-2 gap-2")}
            </article>
          )}
          renderRow={(row) => (
            <TableRow key={row.id}>
              <TableCell><VehicleIdentity code={row.vehicleCode} href={vehicleFichaHref(row.vehicleId)} /></TableCell>
              <TableCell className="whitespace-nowrap">{turnoLabel(row)}</TableCell>
              <TableCell>{row.operatorName}</TableCell>
              <TableCell className="whitespace-nowrap font-mono tabular-nums">{shiftRangeLabel(row.startHour, row.endHour)}</TableCell>
              <TableCellNum>{hoursCell(row, row.summary.engineHours)}</TableCellNum>
              <TableCellNum>{hoursCell(row, row.summary.workingHours)}</TableCellNum>
              <TableCellNum>{hoursCell(row, row.summary.idleHours)}</TableCellNum>
              <TableCell><IdleBar pct={shiftIdlePct(row)} target={target} /></TableCell>
              <TableCell><ShiftStatusBadge status={row.summary.status} /></TableCell>
              <TableCell className="text-right">{rowActions(row)}</TableCell>
            </TableRow>
          )}
        />
      </section>

      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(open) => { if (!open && !voidOp.pending) setVoiding(null) }}
        title={voiding ? `Anular el turno de ${voiding.vehicleCode}` : "Anular turno"}
        description="El turno deja de contar en el ranking y libera sus horas: se puede registrar otro en el mismo horario. Queda en el historial con el motivo."
        variant="destructive"
        confirmLabel="Anular turno"
        reasonLabel="Motivo de la anulación"
        onConfirm={confirmVoid}
        loading={voidOp.pending}
        error={voidOp.message || undefined}
      />
    </div>
  )
}
