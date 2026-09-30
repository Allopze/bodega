"use client"

import { memo, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react"
import { PcSelect } from "@/components/prevention/pc-select"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { activeFilterCount, EMPTY_FILTERS, filterRows, groupRows, type GridFilters, type GroupBy } from "@/lib/prevention/miper/grid-view"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, classify, magnitudeOf, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, type ControlledStatus, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { deleteMiperEntryAction, duplicateMiperEntryAction, saveMiperEntryAction } from "../actions"
import { useRowSaver } from "./use-row-saver"

export type MatrixGridProps = {
  matrixId: string
  rows: MiperEntrySnapshot[]
  onRowsChange: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  entryVersions: Record<string, number>
  editable: boolean
  riskFactors: MiperWorkspace["riskFactors"]
  dictionaries: MiperWorkspace["dictionaries"]
  issuesByEntry: Map<string, CompletenessIssue[]>
  observedEntryIds: Set<string>
  changeByEntry: Map<string, EntryChange>
  canObserve: boolean
  onOpenEntry: (entryId: string) => void
  onStructureChanged: () => void
}

type TextKey = "activity" | "task" | "position" | "location" | "hazard" | "risk" | "probableDamage"
const TEXT_LIST: Record<TextKey, keyof MiperWorkspace["dictionaries"]> = {
  activity: "activities", task: "tasks", position: "positions", location: "locations", hazard: "hazards", risk: "risks", probableDamage: "damages",
}
const COLUMNS: ReadonlyArray<{ key: string; label: string; width: string; sticky?: string }> = [
  { key: "rowNumber", label: "N°", width: "w-12", sticky: "left-0" },
  { key: "activity", label: "Actividad", width: "w-44", sticky: "left-12" },
  { key: "task", label: "Tarea", width: "w-44", sticky: "left-56" },
  { key: "position", label: "Puesto de trabajo", width: "w-40" },
  { key: "location", label: "Lugar específico", width: "w-36" },
  { key: "exposedFemale", label: "F", width: "w-14" },
  { key: "exposedMale", label: "M", width: "w-14" },
  { key: "exposedOther", label: "Otro", width: "w-14" },
  { key: "riskFactorId", label: "Factor de riesgo", width: "w-36" },
  { key: "isRoutine", label: "Rutinaria", width: "w-32" },
  { key: "hazard", label: "Peligro", width: "w-52" },
  { key: "risk", label: "Riesgo", width: "w-44" },
  { key: "probableDamage", label: "Daño probable", width: "w-44" },
  { key: "probability", label: "Probabilidad", width: "w-28" },
  { key: "consequence", label: "Consecuencia", width: "w-28" },
  { key: "classification", label: "MR · Clasificación", width: "w-40" },
  { key: "controlledStatus", label: "¿Controlado?", width: "w-32" },
  { key: "controls", label: "Medidas de control", width: "w-56" },
  { key: "actions", label: "", width: "w-28" },
]

const selectClass = "h-8 w-full rounded-md border border-[var(--color-border)] bg-white px-1.5 text-sm disabled:opacity-60"
const inputClass = "h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-primary)] focus:bg-white focus:outline-none aria-[invalid=true]:border-[var(--color-danger-line)]"

/** Mueve el foco a la misma columna de la fila vecina (flechas / Enter), estilo planilla. */
function moveFocus(event: KeyboardEvent<HTMLElement>, delta: number) {
  const target = event.currentTarget
  const row = Number(target.dataset.row), col = target.dataset.col
  const table = target.closest("table")
  const next = table?.querySelector<HTMLElement>(`[data-grid-cell][data-row="${row + delta}"][data-col="${col}"]`)
  if (next) { event.preventDefault(); next.focus() }
}

function cellKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) { event.currentTarget.blur(); moveFocus(event, 1) }
  else if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) { event.currentTarget.blur(); moveFocus(event, -1) }
  else if (event.key === "Escape") { event.currentTarget.value = event.currentTarget.defaultValue; event.currentTarget.blur() }
}

export function MatrixGrid(props: MatrixGridProps) {
  const { matrixId, rows, onRowsChange, entryVersions, editable, riskFactors, dictionaries, issuesByEntry, observedEntryIds, changeByEntry, canObserve, onOpenEntry, onStructureChanged } = props
  const { save, sync } = useRowSaver(matrixId, entryVersions)
  // Las versiones que trae el servidor mandan cuando la página se refresca.
  useEffect(() => { sync(entryVersions) }, [entryVersions, sync])
  const [filters, setFilters] = useState<GridFilters>(EMPTY_FILTERS)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [pendingDelete, setPendingDelete] = useState<MiperEntrySnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const modified = useMemo(() => new Set([...changeByEntry.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changeByEntry])
  const visible = useMemo(() => filterRows(rows, filters, { observed: observedEntryIds, modified }), [rows, filters, observedEntryIds, modified])
  const groups = useMemo(() => groupRows(visible, groupBy), [visible, groupBy])
  const activeFactors = riskFactors.filter((factor) => factor.isActive)

  async function change(entry: MiperEntrySnapshot, values: MiperEntryValues) {
    // Optimista: la fila cambia y se reclasifica al instante; el servidor confirma.
    onRowsChange((current) => current.map((row) => {
      if (row.id !== entry.id) return row
      const next: MiperEntrySnapshot = { ...row, ...values }
      if ("riskFactorId" in values) {
        const riskFactorId = values.riskFactorId
        next.riskFactor = riskFactors.find((factor) => factor.id === riskFactorId)?.name ?? null
      }
      next.magnitude = magnitudeOf(next.probability, next.consequence)
      next.classification = classify(next.probability, next.consequence)
      return next
    }))
    const key = `${entry.id}:${Object.keys(values).join(",")}`
    const result = await save(entry.id, values)
    if (!result.ok) {
      setCellErrors((current) => ({ ...current, [key]: result.message }))
      toast.error(`Riesgo #${entry.rowNumber}: ${result.message}`)
      return
    }
    setCellErrors((current) => Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key)))
  }

  async function structural(operation: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true)
    const state = await operation()
    setBusy(false)
    if (!state.ok) { toast.error(state.message ?? "No se pudo completar la acción."); return }
    onStructureChanged()
  }

  const addBelow = (entry: MiperEntrySnapshot | null) => structural(() => saveMiperEntryAction({
    matrixId,
    insertAfterRowNumber: entry?.rowNumber ?? null,
    values: entry ? { activity: entry.activity, task: entry.task, position: entry.position, location: entry.location, isRoutine: entry.isRoutine } : {},
  }))

  function textCell(entry: MiperEntrySnapshot, key: TextKey, rowIndex: number, colIndex: number) {
    const errorKey = `${entry.id}:${key}`
    return (
      <input
        data-grid-cell="true" data-row={rowIndex} data-col={colIndex}
        aria-label={`${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
        aria-invalid={Boolean(cellErrors[errorKey]) || undefined}
        title={cellErrors[errorKey]}
        list={`miper-list-${key}`}
        className={inputClass}
        defaultValue={entry[key] ?? ""}
        key={`${entry.id}-${key}-${entry[key] ?? ""}`}
        onKeyDown={cellKeyDown}
        onBlur={(event) => {
          const value = event.target.value.replace(/\s+/g, " ").trim()
          if (value !== (entry[key] ?? "")) void change(entry, { [key]: value || null })
        }}
      />
    )
  }

  function numberCell(entry: MiperEntrySnapshot, key: "exposedFemale" | "exposedMale" | "exposedOther", rowIndex: number, colIndex: number) {
    return (
      <input
        data-grid-cell="true" data-row={rowIndex} data-col={colIndex} type="number" min={0}
        aria-label={`Expuestos ${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
        className={cn(inputClass, "tabular-nums")}
        defaultValue={entry[key]}
        key={`${entry.id}-${key}-${entry[key]}`}
        onKeyDown={cellKeyDown}
        onBlur={(event) => {
          const value = Math.max(0, Number(event.target.value || 0))
          if (value !== entry[key]) void change(entry, { [key]: value })
        }}
      />
    )
  }

  function renderRow(entry: MiperEntrySnapshot, rowIndex: number) {
    const issues = issuesByEntry.get(entry.id) ?? []
    const errors = issues.filter((issue) => issue.severity === "error")
    const entryChange = changeByEntry.get(entry.id)
    const observed = observedEntryIds.has(entry.id)
    const stickyBg = entry.classification === "intolerable" ? "bg-[var(--color-danger-tint)]" : "bg-white"
    return (
      <tr key={entry.id} className={cn("border-b align-top", entry.classification === "intolerable" && "bg-[var(--color-danger-tint)]")}>
        <td className={cn("sticky left-0 z-10 px-2 py-1 text-sm tabular-nums", stickyBg)}>
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => onOpenEntry(entry.id)} aria-label={`Abrir detalle del riesgo ${entry.rowNumber}`}>{entry.rowNumber}</button>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {entryChange && <span className="rounded bg-[var(--color-signal-tint)] px-1 text-[10px] font-semibold text-[var(--color-signal-ink)]">{entryChange.kind === "added" ? "Nueva" : "Modificada"}</span>}
            {observed && <span className="rounded bg-[var(--color-warning-tint)] px-1 text-[10px] font-semibold text-[var(--color-warning-ink)]">Observada</span>}
            {errors.length > 0 && <span className="rounded bg-[var(--color-danger-tint)] px-1 text-[10px] font-semibold text-[var(--color-danger-ink)]" title={errors.map((issue) => issue.message).join("\n")}>{errors.length} pend.</span>}
          </div>
        </td>
        {editable ? <>
          <td className={cn("sticky left-12 z-10 px-1 py-1", stickyBg)}>{textCell(entry, "activity", rowIndex, 1)}</td>
          <td className={cn("sticky left-56 z-10 px-1 py-1", stickyBg)}>{textCell(entry, "task", rowIndex, 2)}</td>
          <td className="px-1 py-1">{textCell(entry, "position", rowIndex, 3)}</td>
          <td className="px-1 py-1">{textCell(entry, "location", rowIndex, 4)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedFemale", rowIndex, 5)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedMale", rowIndex, 6)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedOther", rowIndex, 7)}</td>
          <td className="px-1 py-1">
            <select aria-label={`Factor de riesgo riesgo ${entry.rowNumber}`} className={selectClass} value={entry.riskFactorId ?? ""} onChange={(event) => void change(entry, { riskFactorId: event.target.value || null })}>
              <option value="">—</option>
              {activeFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
              {entry.riskFactorId && !activeFactors.some((factor) => factor.id === entry.riskFactorId) && <option value={entry.riskFactorId}>{entry.riskFactor ?? "Factor desactivado"}</option>}
            </select>
          </td>
          <td className="px-1 py-1">
            <select aria-label={`Rutinaria riesgo ${entry.rowNumber}`} className={selectClass} value={entry.isRoutine === null ? "" : entry.isRoutine ? "yes" : "no"} onChange={(event) => void change(entry, { isRoutine: event.target.value === "" ? null : event.target.value === "yes" })}>
              <option value="">—</option><option value="yes">Rutinaria</option><option value="no">No rutinaria</option>
            </select>
          </td>
          <td className="px-1 py-1">{textCell(entry, "hazard", rowIndex, 10)}</td>
          <td className="px-1 py-1">{textCell(entry, "risk", rowIndex, 11)}</td>
          <td className="px-1 py-1">{textCell(entry, "probableDamage", rowIndex, 12)}</td>
          <td className="px-1 py-1"><PcSelect kind="probability" ariaLabel={`Probabilidad riesgo ${entry.rowNumber}`} value={entry.probability} onChange={(value) => void change(entry, { probability: value })} /></td>
          <td className="px-1 py-1"><PcSelect kind="consequence" ariaLabel={`Consecuencia riesgo ${entry.rowNumber}`} value={entry.consequence} onChange={(value) => void change(entry, { consequence: value })} /></td>
        </> : <>
          <td className={cn("sticky left-12 z-10 px-2 py-1 text-sm", stickyBg)}>{entry.activity ?? "—"}</td>
          <td className={cn("sticky left-56 z-10 px-2 py-1 text-sm", stickyBg)}>{entry.task ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.position ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.location ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedFemale}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedMale}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedOther}</td>
          <td className="px-2 py-1 text-sm">{entry.riskFactor ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.isRoutine === null ? "—" : entry.isRoutine ? "Rutinaria" : "No rutinaria"}</td>
          <td className="px-2 py-1 text-sm">{entry.hazard ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.risk ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.probableDamage ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.probability ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.consequence ?? "—"}</td>
        </>}
        <td className="px-2 py-1"><RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} /></td>
        <td className="px-1 py-1">
          {editable ? (
            <select aria-label={`¿Controlado? riesgo ${entry.rowNumber}`} className={selectClass} value={entry.controlledStatus ?? ""} onChange={(event) => void change(entry, { controlledStatus: (event.target.value || null) as ControlledStatus | null })}>
              <option value="">—</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
            </select>
          ) : <span className="text-sm">{entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "—"}</span>}
        </td>
        <td className="px-2 py-1">
          <button type="button" className="flex w-full flex-wrap gap-1 text-left" onClick={() => onOpenEntry(entry.id)} aria-label={`Medidas de control del riesgo ${entry.rowNumber} (${entry.controls.length})`}>
            {entry.controls.length === 0 ? <span className="text-xs text-[var(--color-text-subtle)]">{editable ? "+ Agregar medida" : "Sin medidas"}</span>
              : entry.controls.map((control) => <span key={control.id} title={`${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">{CONTROL_HIERARCHY_LABEL[control.hierarchy].split(".")[0]}. {control.description.slice(0, 28)}{control.description.length > 28 ? "…" : ""}</span>)}
          </button>
        </td>
        <td className="px-1 py-1">
          <div className="flex gap-1">
            {editable && <>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void addBelow(entry)} aria-label={`Agregar fila debajo del riesgo ${entry.rowNumber}`} title="Agregar debajo (copia actividad, tarea, puesto y lugar)">+</Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void structural(() => duplicateMiperEntryAction({ matrixId, entryId: entry.id }))} aria-label={`Duplicar riesgo ${entry.rowNumber}`} title="Duplicar">⧉</Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPendingDelete(entry)} aria-label={`Eliminar riesgo ${entry.rowNumber}`} title="Eliminar">✕</Button>
            </>}
            {canObserve && <Button type="button" size="sm" variant="secondary" onClick={() => onOpenEntry(entry.id)} aria-label={`Observar riesgo ${entry.rowNumber}`}>Observar</Button>}
          </div>
        </td>
      </tr>
    )
  }

  let rowIndex = 0
  return (
    <section className="space-y-3">
      {/* Filtros primarios (A2): búsqueda, clasificación, controlado, factor, agrupación + atajos de revisión. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs">Buscar en la matriz
          <Input className="h-9 w-64" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Actividad, peligro, medida…" />
        </label>
        <label className="flex flex-col text-xs">Clasificación
          <select className={cn(selectClass, "h-9 w-40")} value={filters.classifications.length === 1 ? filters.classifications[0] : "all"} onChange={(event) => setFilters({ ...filters, classifications: event.target.value === "all" ? [] : [event.target.value as RiskClassification] })}>
            <option value="all">Todas</option>{RISK_CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{CLASSIFICATION_LABEL[cls]}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">¿Controlado?
          <select className={cn(selectClass, "h-9 w-36")} value={filters.controlled} onChange={(event) => setFilters({ ...filters, controlled: event.target.value as GridFilters["controlled"] })}>
            <option value="all">Todos</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col text-xs">Factor
          <select className={cn(selectClass, "h-9 w-40")} value={filters.factorId} onChange={(event) => setFilters({ ...filters, factorId: event.target.value })}>
            <option value="all">Todos</option>{riskFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">Agrupar por
          <select className={cn(selectClass, "h-9 w-40")} value={groupBy} onChange={(event) => { setGroupBy(event.target.value as GroupBy); setCollapsed(new Set()) }}>
            <option value="none">Sin agrupar</option><option value="activity">Actividad</option><option value="position">Puesto de trabajo</option><option value="classification">Clasificación</option>
          </select>
        </label>
        {editable && <Button type="button" className="ml-auto" disabled={busy} onClick={() => void addBelow(null)}>Agregar fila</Button>}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros rápidos">
        {([
          ["Solo Importantes", filters.classifications.length === 1 && filters.classifications[0] === "important", () => setFilters({ ...filters, classifications: ["important"] })],
          ["Solo Intolerables", filters.classifications.length === 1 && filters.classifications[0] === "intolerable", () => setFilters({ ...filters, classifications: ["intolerable"] })],
          ["No controlados", filters.controlled === "no", () => setFilters({ ...filters, controlled: "no" })],
          ["Observados", filters.onlyObserved, () => setFilters({ ...filters, onlyObserved: !filters.onlyObserved })],
          ["Modificados", filters.onlyModified, () => setFilters({ ...filters, onlyModified: !filters.onlyModified })],
        ] as Array<[string, boolean, () => void]>).map(([label, active, onClick]) => (
          <button key={label} type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" : "border-[var(--color-border)]")}>{label}</button>
        ))}
        {activeFilterCount(filters) > 0 && <button type="button" className="text-xs underline" onClick={() => setFilters(EMPTY_FILTERS)}>Quitar filtros ({activeFilterCount(filters)})</button>}
        <span className="ml-auto text-xs text-[var(--color-text-subtle)]">{visible.length} de {rows.length} riesgos</span>
      </div>

      {Object.entries(TEXT_LIST).map(([key, list]) => (
        <datalist key={key} id={`miper-list-${key}`}>{dictionaries[list].map((value) => <option key={value} value={value} />)}</datalist>
      ))}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="font-medium">La matriz aún no tiene registros de evaluación</p>
          <p className="mt-1 text-sm text-[var(--color-text-subtle)]">Cada fila es una situación concreta de exposición: actividad, tarea, puesto, peligro y riesgo.</p>
          {editable && <Button type="button" className="mt-3" onClick={() => void addBelow(null)}>Agregar la primera fila</Button>}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/70 bg-white md:block">
            <table className="min-w-[2400px] table-fixed border-collapse">
              <caption className="sr-only">Matriz de identificación de peligros y evaluación de riesgos</caption>
              <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
                <tr>{COLUMNS.map((column) => <th key={column.key} scope="col" className={cn(column.width, "px-2 py-2 text-left text-xs font-semibold", column.sticky && `sticky ${column.sticky} z-30 bg-[var(--color-surface-2)]`)}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupRows key={group.key} label={group.label} count={group.rows.length} collapsed={collapsed.has(group.key)}
                    onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}>
                    {group.rows.map((entry) => renderRow(entry, rowIndex++))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
          {/* Móvil: lectura en tarjetas (§8.2); la edición es de escritorio. */}
          <ul className="space-y-2 md:hidden">
            {visible.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => onOpenEntry(entry.id)} className="w-full rounded-xl border bg-white p-3 text-left">
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">#{entry.rowNumber} · {entry.hazard ?? "Peligro sin describir"}</span><RiskClassificationBadge classification={entry.classification} size="sm" /></div>
                  <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{[entry.activity, entry.task, entry.position].filter(Boolean).join(" · ")}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={`Eliminar el riesgo #${pendingDelete?.rowNumber ?? ""}`} description="La fila y sus medidas se eliminan. Queda registrado en el historial." confirmLabel="Eliminar" variant="destructive"
        loading={busy}
        onConfirm={() => { const entry = pendingDelete; setPendingDelete(null); if (entry) void structural(() => deleteMiperEntryAction({ matrixId, entryId: entry.id, expectedVersion: entryVersions[entry.id] })) }} />
    </section>
  )
}

const GroupRows = memo(function GroupRows({ label, count, collapsed, onToggle, children }: { label: string; count: number; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      {label && (
        <tr className="bg-[var(--color-surface-2)]">
          <td colSpan={COLUMNS.length} className="px-2 py-1.5">
            <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="text-sm font-semibold">{collapsed ? "▸" : "▾"} {label} <span className="font-normal text-[var(--color-text-subtle)]">({count})</span></button>
          </td>
        </tr>
      )}
      {!collapsed && children}
    </>
  )
})
