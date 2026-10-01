"use client"

import { memo, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react"
import { Eye, WarningCircle, X } from "@phosphor-icons/react"
import { PcSelect } from "@/components/prevention/pc-select"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { activeFilterCount, EMPTY_FILTERS, filterRows, groupRows, type GridFilters, type GroupBy } from "@/lib/prevention/miper/grid-view"
import { CLASSIFICATION_LABEL, classify, magnitudeOf } from "@/lib/prevention/miper/methodology"
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
  /** Los filtros viven en el espacio de trabajo: la franja de resumen filtra por clasificación. */
  filters: GridFilters
  onFiltersChange: (filters: GridFilters) => void
  /** Hay foto contra la que comparar (versión aprobada o ronda técnica anterior). Sin ella todas las filas son «nuevas»: marcarlas no informa nada. */
  hasBaseline: boolean
}

type TextKey = "activity" | "task" | "position" | "location" | "hazard" | "risk" | "probableDamage"
const TEXT_LIST: Record<TextKey, keyof MiperWorkspace["dictionaries"]> = {
  activity: "activities", task: "tasks", position: "positions", location: "locations", hazard: "hazards", risk: "risks", probableDamage: "damages",
}
/**
 * Orden de lectura, no el del Excel RE-04: tras la identificación fija (N°,
 * actividad, tarea) va la evaluación completa —peligro → medidas— para que el
 * resultado quepa en pantalla sin desplazarse; el contexto del puesto (puesto,
 * lugar, factor, expuestos) queda a la derecha. La exportación conserva el RE-04.
 */
const COLUMNS: ReadonlyArray<{ key: string; label: string; width: string; sticky?: string }> = [
  { key: "rowNumber", label: "N°", width: "w-20", sticky: "left-0" },
  { key: "activity", label: "Actividad", width: "w-40", sticky: "left-20" },
  { key: "task", label: "Tarea", width: "w-40", sticky: "left-60" },
  { key: "hazard", label: "Peligro", width: "w-44" },
  { key: "risk", label: "Riesgo", width: "w-40" },
  { key: "probableDamage", label: "Daño probable", width: "w-40" },
  { key: "probability", label: "Probabilidad", width: "w-28" },
  { key: "consequence", label: "Consecuencia", width: "w-28" },
  { key: "classification", label: "MR · Clasificación", width: "w-40" },
  { key: "controlledStatus", label: "¿Controlado?", width: "w-32" },
  { key: "controls", label: "Medidas de control", width: "w-56" },
  { key: "position", label: "Puesto de trabajo", width: "w-40" },
  { key: "location", label: "Lugar específico", width: "w-36" },
  { key: "riskFactorId", label: "Factor de riesgo", width: "w-36" },
  { key: "isRoutine", label: "Rutinaria", width: "w-32" },
  { key: "exposedFemale", label: "F", width: "w-14" },
  { key: "exposedMale", label: "M", width: "w-14" },
  { key: "exposedOther", label: "Otro", width: "w-14" },
  { key: "actions", label: "", width: "w-28" },
]
const LAST_STICKY = COLUMNS.filter((column) => column.sticky).at(-1)!.sticky
const COL = Object.fromEntries(COLUMNS.map((column, index) => [column.key, index])) as Record<string, number>
/** Campo del validador → columna donde se marca. Lo que no es de la fila (plazos, responsables, vínculo al programa) cae en «Medidas». */
const ISSUE_COLUMN: Record<string, string> = {
  activity: "activity", task: "task", position: "position", riskFactorId: "riskFactorId", hazard: "hazard", risk: "risk",
  probableDamage: "probableDamage", controlledStatus: "controlledStatus", probability: "probability", consequence: "consequence",
}
/** Columnas de contexto donde un valor igual al de la fila anterior se atenúa (se lee como «ídem»). */
const DITTO_KEYS = new Set<TextKey>(["activity", "task", "position", "location"])

const selectClass = "h-8 w-full rounded-md border border-[var(--color-border)] bg-white px-1.5 text-sm disabled:opacity-60 aria-[invalid=true]:border-[var(--color-danger)] aria-[invalid=true]:bg-[var(--color-danger-tint)]"
const inputClass = "h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-primary)] focus:bg-white focus:outline-none aria-[invalid=true]:border-[var(--color-danger)]"
/** Sin flechas de incremento: en una celda de 56 px sólo tapan el número. */
const numberClass = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
const cellClass = "border-b border-[var(--color-border)] px-1 py-1 align-top"

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
  const { matrixId, rows, onRowsChange, entryVersions, editable, riskFactors, dictionaries, issuesByEntry, observedEntryIds, changeByEntry, canObserve, onOpenEntry, onStructureChanged, filters, onFiltersChange: setFilters, hasBaseline } = props
  const { save, sync } = useRowSaver(matrixId, entryVersions)
  // Las versiones que trae el servidor mandan cuando la página se refresca.
  useEffect(() => { sync(entryVersions) }, [entryVersions, sync])
  // Agrupar por actividad de entrada: una matriz importada repite la actividad en decenas de filas seguidas.
  const [groupBy, setGroupBy] = useState<GroupBy>("activity")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [pendingDelete, setPendingDelete] = useState<MiperEntrySnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const modified = useMemo(() => new Set([...changeByEntry.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changeByEntry])
  const incomplete = useMemo(() => new Set([...issuesByEntry].filter(([, issues]) => issues.some((issue) => issue.severity === "error")).map(([entryId]) => entryId)), [issuesByEntry])
  const visible = useMemo(() => filterRows(rows, filters, { observed: observedEntryIds, modified, incomplete }), [rows, filters, observedEntryIds, modified, incomplete])
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

  /** Mensajes del validador para una celda (o `undefined` si está completa). */
  function cellIssue(entry: MiperEntrySnapshot, column: string) {
    const messages = (issuesByEntry.get(entry.id) ?? [])
      .filter((issue) => issue.severity === "error" && (ISSUE_COLUMN[issue.field] ?? "controls") === column)
      .map((issue) => issue.message)
    return messages.length ? messages.join("\n") : undefined
  }

  /**
   * Celda de texto que se lee completa: el texto va en un bloque que se parte en
   * líneas y el `<input>` —con su `datalist` y la navegación de planilla— queda
   * encima, transparente hasta que recibe el foco.
   */
  function textCell(entry: MiperEntrySnapshot, key: TextKey, rowIndex: number, previous: MiperEntrySnapshot | undefined) {
    const colIndex = COL[key]!
    const saveError = cellErrors[`${entry.id}:${key}`]
    const missing = cellIssue(entry, key)
    const value = entry[key] ?? ""
    const ditto = DITTO_KEYS.has(key) && Boolean(value) && previous?.[key] === entry[key]
    return (
      <div className="relative">
        <div aria-hidden="true" className={cn("min-h-8 whitespace-pre-wrap break-words px-1.5 py-1.5 text-sm leading-5",
          ditto && "text-[var(--color-text-faint)]", !value && missing && "text-xs italic text-[var(--color-danger-ink)]")}>
          {value || (missing ? "Falta" : " ")}
        </div>
        <input
          data-grid-cell="true" data-row={rowIndex} data-col={colIndex}
          aria-label={`${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
          aria-invalid={Boolean(saveError || missing) || undefined}
          title={saveError ?? missing ?? (value || undefined)}
          list={`miper-list-${key}`}
          className={cn(inputClass, "absolute inset-0 h-full text-transparent caret-transparent focus:text-[var(--color-text)] focus:caret-[var(--color-text)]")}
          defaultValue={value}
          key={`${entry.id}-${key}-${value}`}
          onKeyDown={cellKeyDown}
          onBlur={(event) => {
            const next = event.target.value.replace(/\s+/g, " ").trim()
            if (next !== value) void change(entry, { [key]: next || null })
          }}
        />
      </div>
    )
  }

  function numberCell(entry: MiperEntrySnapshot, key: "exposedFemale" | "exposedMale" | "exposedOther", rowIndex: number) {
    const colIndex = COL[key]!
    return (
      <input
        data-grid-cell="true" data-row={rowIndex} data-col={colIndex} type="number" min={0}
        aria-label={`Expuestos ${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
        className={cn(inputClass, numberClass, "tabular-nums")}
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

  function renderRow(entry: MiperEntrySnapshot, rowIndex: number, previous: MiperEntrySnapshot | undefined) {
    const issues = issuesByEntry.get(entry.id) ?? []
    const errors = issues.filter((issue) => issue.severity === "error")
    const entryChange = hasBaseline ? changeByEntry.get(entry.id) : undefined
    const observed = observedEntryIds.has(entry.id)
    const intolerable = entry.classification === "intolerable"
    const td = cn(cellClass, intolerable && "bg-[var(--color-danger-tint)]")
    // La última fija (tarea) lleva borde: marca dónde pasa por debajo lo que se desplaza.
    const sticky = (offset: string) => cn(td, "sticky z-10", offset, offset === LAST_STICKY && "border-r", intolerable ? "bg-[var(--color-danger-tint)]" : "bg-white")
    const plain = (value: ReactNode) => <div className="px-1 py-1.5 text-sm leading-5 break-words">{value}</div>
    const controlsIssue = cellIssue(entry, "controls")
    return (
      <tr key={entry.id}>
        <td className={sticky("left-0")}>
          <div className="flex flex-col gap-1 px-1 py-1.5">
            <button type="button" className="self-start text-sm font-semibold tabular-nums underline-offset-2 hover:underline" onClick={() => onOpenEntry(entry.id)} aria-label={`Abrir detalle del riesgo ${entry.rowNumber}`}>{entry.rowNumber}</button>
            {(entryChange || observed || errors.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                {entryChange && (
                  <span title={`${entryChange.kind === "added" ? "Nueva" : "Modificada"} respecto de la versión anterior`} className="rounded bg-[var(--color-signal-tint)] px-1 py-0.5 text-[10px] font-semibold leading-none text-[var(--color-signal-ink)]">
                    {entryChange.kind === "added" ? "Nueva" : "Modificada"}
                  </span>
                )}
                {observed && (
                  <span title="Tiene observaciones de la revisión" className="inline-flex rounded bg-[var(--color-warning-tint)] p-0.5 text-[var(--color-warning-ink)]">
                    <Eye aria-hidden weight="bold" className="size-3" /><span className="sr-only">Observada</span>
                  </span>
                )}
                {errors.length > 0 && (
                  <span title={errors.map((issue) => issue.message).join("\n")} className="inline-flex items-center gap-0.5 rounded bg-[var(--color-danger-tint)] px-1 py-0.5 text-[10px] font-semibold leading-none text-[var(--color-danger-ink)]">
                    <WarningCircle aria-hidden weight="bold" className="size-3" />{errors.length}<span className="sr-only"> pendiente{errors.length === 1 ? "" : "s"}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </td>
        {editable ? <>
          <td className={sticky("left-20")}>{textCell(entry, "activity", rowIndex, previous)}</td>
          <td className={sticky("left-60")}>{textCell(entry, "task", rowIndex, previous)}</td>
          <td className={td}>{textCell(entry, "hazard", rowIndex, previous)}</td>
          <td className={td}>{textCell(entry, "risk", rowIndex, previous)}</td>
          <td className={td}>{textCell(entry, "probableDamage", rowIndex, previous)}</td>
          <td className={td}><PcSelect kind="probability" ariaLabel={`Probabilidad riesgo ${entry.rowNumber}`} invalidMessage={cellIssue(entry, "probability")} value={entry.probability} onChange={(value) => void change(entry, { probability: value })} /></td>
          <td className={td}><PcSelect kind="consequence" ariaLabel={`Consecuencia riesgo ${entry.rowNumber}`} invalidMessage={cellIssue(entry, "consequence")} value={entry.consequence} onChange={(value) => void change(entry, { consequence: value })} /></td>
        </> : <>
          <td className={sticky("left-20")}>{plain(entry.activity ?? "—")}</td>
          <td className={sticky("left-60")}>{plain(entry.task ?? "—")}</td>
          <td className={td}>{plain(entry.hazard ?? "—")}</td>
          <td className={td}>{plain(entry.risk ?? "—")}</td>
          <td className={td}>{plain(entry.probableDamage ?? "—")}</td>
          <td className={td}>{plain(<span className="tabular-nums">{entry.probability ?? "—"}</span>)}</td>
          <td className={td}>{plain(<span className="tabular-nums">{entry.consequence ?? "—"}</span>)}</td>
        </>}
        <td className={td}><div className="py-1"><RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} /></div></td>
        <td className={td}>
          {editable ? (
            <select aria-label={`¿Controlado? riesgo ${entry.rowNumber}`} aria-invalid={Boolean(cellIssue(entry, "controlledStatus")) || undefined} title={cellIssue(entry, "controlledStatus")} className={selectClass} value={entry.controlledStatus ?? ""} onChange={(event) => void change(entry, { controlledStatus: (event.target.value || null) as ControlledStatus | null })}>
              <option value="">—</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
            </select>
          ) : plain(entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "—")}
        </td>
        <td className={td}>
          <button type="button" title={controlsIssue}
            className={cn("flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border px-1 py-1 text-left", controlsIssue ? "border-[var(--color-danger)]" : "border-transparent hover:border-[var(--color-border)]")}
            onClick={() => onOpenEntry(entry.id)} aria-label={`Medidas de control del riesgo ${entry.rowNumber} (${entry.controls.length})`}>
            {entry.controls.length === 0
              ? <span className={cn("text-xs", controlsIssue ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-subtle)]")}>{editable ? "+ Agregar medida" : "Sin medidas"}</span>
              : entry.controls.map((control) => <span key={control.id} title={`${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">{CONTROL_HIERARCHY_LABEL[control.hierarchy].split(".")[0]}. {control.description.slice(0, 28)}{control.description.length > 28 ? "…" : ""}</span>)}
          </button>
        </td>
        {editable ? <>
          <td className={td}>{textCell(entry, "position", rowIndex, previous)}</td>
          <td className={td}>{textCell(entry, "location", rowIndex, previous)}</td>
          <td className={td}>
            <select aria-label={`Factor de riesgo riesgo ${entry.rowNumber}`} aria-invalid={Boolean(cellIssue(entry, "riskFactorId")) || undefined} title={cellIssue(entry, "riskFactorId")} className={selectClass} value={entry.riskFactorId ?? ""} onChange={(event) => void change(entry, { riskFactorId: event.target.value || null })}>
              <option value="">—</option>
              {activeFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
              {entry.riskFactorId && !activeFactors.some((factor) => factor.id === entry.riskFactorId) && <option value={entry.riskFactorId}>{entry.riskFactor ?? "Factor desactivado"}</option>}
            </select>
          </td>
          <td className={td}>
            <select aria-label={`Rutinaria riesgo ${entry.rowNumber}`} className={selectClass} value={entry.isRoutine === null ? "" : entry.isRoutine ? "yes" : "no"} onChange={(event) => void change(entry, { isRoutine: event.target.value === "" ? null : event.target.value === "yes" })}>
              <option value="">—</option><option value="yes">Rutinaria</option><option value="no">No rutinaria</option>
            </select>
          </td>
          <td className={td}>{numberCell(entry, "exposedFemale", rowIndex)}</td>
          <td className={td}>{numberCell(entry, "exposedMale", rowIndex)}</td>
          <td className={td}>{numberCell(entry, "exposedOther", rowIndex)}</td>
        </> : <>
          <td className={td}>{plain(entry.position ?? "—")}</td>
          <td className={td}>{plain(entry.location ?? "—")}</td>
          <td className={td}>{plain(entry.riskFactor ?? "—")}</td>
          <td className={td}>{plain(entry.isRoutine === null ? "—" : entry.isRoutine ? "Rutinaria" : "No rutinaria")}</td>
          <td className={td}>{plain(<span className="tabular-nums">{entry.exposedFemale}</span>)}</td>
          <td className={td}>{plain(<span className="tabular-nums">{entry.exposedMale}</span>)}</td>
          <td className={td}>{plain(<span className="tabular-nums">{entry.exposedOther}</span>)}</td>
        </>}
        <td className={td}>
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

  const quickFilters: Array<[string, boolean, () => void]> = [
    [`Con pendientes (${incomplete.size})`, filters.onlyIncomplete, () => setFilters({ ...filters, onlyIncomplete: !filters.onlyIncomplete })],
    ["Observados", filters.onlyObserved, () => setFilters({ ...filters, onlyObserved: !filters.onlyObserved })],
    ...(hasBaseline ? [["Modificados", filters.onlyModified, () => setFilters({ ...filters, onlyModified: !filters.onlyModified })] as [string, boolean, () => void]] : []),
  ]
  let rowIndex = 0
  return (
    <section className="space-y-3">
      {/* Filtros primarios (A2). La clasificación se filtra desde la franja de resumen (A5: una sola representación). */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">Buscar en la matriz
          <Input className="h-9 w-64" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Actividad, peligro, medida…" />
        </label>
        <label className="flex flex-col gap-1 text-xs">¿Controlado?
          <select className={cn(selectClass, "h-9 w-36")} value={filters.controlled} onChange={(event) => setFilters({ ...filters, controlled: event.target.value as GridFilters["controlled"] })}>
            <option value="all">Todos</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Factor
          <select className={cn(selectClass, "h-9 w-40")} value={filters.factorId} onChange={(event) => setFilters({ ...filters, factorId: event.target.value })}>
            <option value="all">Todos</option>{riskFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Agrupar por
          <select className={cn(selectClass, "h-9 w-40")} value={groupBy} onChange={(event) => { setGroupBy(event.target.value as GroupBy); setCollapsed(new Set()) }}>
            <option value="none">Sin agrupar</option><option value="activity">Actividad</option><option value="position">Puesto de trabajo</option><option value="classification">Clasificación</option>
          </select>
        </label>
        {editable && <Button type="button" className="ml-auto" disabled={busy} onClick={() => void addBelow(null)}>Agregar fila</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros rápidos">
        {quickFilters.map(([label, active, onClick]) => (
          <button key={label} type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" : "border-[var(--color-border)]")}>{label}</button>
        ))}
        {filters.classifications.map((cls) => (
          <button key={cls} type="button" onClick={() => setFilters({ ...filters, classifications: filters.classifications.filter((item) => item !== cls) })}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] px-3 py-1 text-xs text-[var(--color-signal-ink)]"
            aria-label={`Quitar filtro de clasificación ${CLASSIFICATION_LABEL[cls]}`}>
            {CLASSIFICATION_LABEL[cls]}<X aria-hidden weight="bold" className="size-3" />
          </button>
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
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="font-medium">Ningún riesgo cumple los filtros</p>
          <p className="mt-1 text-sm text-[var(--color-text-subtle)]">Hay {rows.length} riesgos en la matriz; los filtros activos los ocultan todos.</p>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setFilters(EMPTY_FILTERS)}>Quitar filtros</Button>
        </div>
      ) : (
        <>
          {/* Desplazamiento propio en ambos ejes: así la cabecera queda fija al bajar por cientos de filas. */}
          <div className="hidden max-h-[calc(100dvh-12rem)] overflow-auto rounded-2xl border border-[var(--color-border)] bg-white md:block">
            {/* `table-fixed` sólo respeta los anchos con un `width` explícito (con `min-width` vuelve al reparto por
                contenido y las columnas fijas dejan de calzar con sus `left-*`): es la suma exacta de COLUMNS. */}
            <table className="w-[155.5rem] table-fixed border-separate border-spacing-0">
              <caption className="sr-only">Matriz de identificación de peligros y evaluación de riesgos</caption>
              <thead>
                <tr>{COLUMNS.map((column) => <th key={column.key} scope="col" className={cn(column.width, "sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-2 text-left text-xs font-semibold", column.sticky && `${column.sticky} z-30`, column.sticky === LAST_STICKY && "border-r")}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupRows key={group.key} label={group.label} count={group.rows.length} collapsed={collapsed.has(group.key)}
                    onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}>
                    {group.rows.map((entry, index) => renderRow(entry, rowIndex++, group.rows[index - 1]))}
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
        <tr>
          <td colSpan={COLUMNS.length} className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
            {/* La etiqueta se queda a la vista aunque la tabla se desplace a la derecha. */}
            <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="sticky left-2 text-sm font-semibold">{collapsed ? "▸" : "▾"} {label} <span className="font-normal text-[var(--color-text-subtle)]">({count})</span></button>
          </td>
        </tr>
      )}
      {!collapsed && children}
    </>
  )
})
