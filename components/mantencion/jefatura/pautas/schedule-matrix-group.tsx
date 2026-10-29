"use client"

import * as React from "react"
import { CaretDown, CaretRight, Check } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatReading, plural } from "@/lib/mantencion/format"
import type { MantUnit } from "@/lib/mantencion/types"
import type { EditorGroup, EditorInterval, EditorItem } from "@/lib/services/mantencion/schedules"

/** «Quitar» aparece al pasar el mouse o al enfocar la fila; con pantalla táctil (sin hover) queda siempre visible. */
const REMOVE_CLASS = cn(
  "rounded-md px-2 py-1 text-xs font-medium text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)]",
  "focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]",
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100",
  "[@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
)

function Cell({ item, interval, unit, applies, review, onToggle }: {
  item: EditorItem
  interval: EditorInterval
  unit: MantUnit
  applies: boolean
  review: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <td className={cn("px-1 py-1 text-center", review && "bg-[var(--color-warning-tint)]/60")}>
      <button
        type="button"
        aria-pressed={applies}
        aria-label={`${item.name} en ${formatReading(interval.value, unit)}`}
        onClick={() => onToggle(!applies)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-[var(--duration-fast)] sm:h-7 sm:w-7",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]",
          applies
            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
            : "border-[var(--color-border-control)] bg-[var(--color-surface)] text-transparent hover:border-[var(--color-border-control-hover)]",
        )}
      >
        <Check size={14} weight="bold" aria-hidden />
      </button>
    </td>
  )
}

/** Fila para escribir un ítem nuevo dentro de un sistema; queda abierta para cargar varios seguidos. */
function AddItemRow({ group, colSpan, busy, onAdd, onClose }: {
  group: EditorGroup
  colSpan: number
  busy: boolean
  onAdd: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [name, setName] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => inputRef.current?.focus(), [])

  async function submit() {
    if (!name.trim()) { inputRef.current?.focus(); return }
    if (await onAdd(name)) { setName(""); inputRef.current?.focus() }
  }

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-2">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <label className="sr-only" htmlFor={`add-item-${group.id}`}>Nuevo ítem en {group.name}</label>
          <Input
            ref={inputRef}
            id={`add-item-${group.id}`}
            value={name}
            maxLength={120}
            autoComplete="off"
            placeholder={`Nombre de la actividad en ${group.name}`}
            className="max-w-md flex-1"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onClose() }}
          />
          <Button type="submit" variant="secondary" size="sm" loading={busy}>Agregar</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Listo</Button>
        </form>
      </td>
    </tr>
  )
}

export function ScheduleMatrixGroup({ group, intervals, unit, cells, collapsed, searching, adding, busy, onToggleGroup, onToggleCell, onRemove, onStartAdd, onStopAdd, onAddItem }: {
  group: EditorGroup
  intervals: EditorInterval[]
  unit: MantUnit
  cells: Record<string, boolean>
  collapsed: boolean
  searching: boolean
  adding: boolean
  busy: boolean
  onToggleGroup: () => void
  onToggleCell: (item: EditorItem, interval: EditorInterval, next: boolean) => void
  onRemove: (item: EditorItem) => void
  onStartAdd: () => void
  onStopAdd: () => void
  onAddItem: (name: string) => Promise<boolean>
}) {
  const colSpan = intervals.length + 2
  const Caret = collapsed ? CaretRight : CaretDown
  return (
    <tbody>
      <tr className="bg-[var(--color-surface-2)]">
        <th scope="rowgroup" colSpan={colSpan} className="px-2 py-1 text-left font-normal">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggleGroup}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-[var(--color-chrome-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          >
            <Caret size={14} weight="bold" aria-hidden />
            <span className="text-sm font-semibold text-[var(--color-text)]">{group.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-muted)]">{plural(group.items.length, "ítem", "ítems")}</span>
          </button>
        </th>
      </tr>
      {!collapsed && group.items.map((item) => (
        <tr key={item.id} className="group/row border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/60">
          <th scope="row" className="px-3 py-1.5 text-left text-sm font-normal text-[var(--color-text)]">
            {item.name}
            {item.note && <Badge variant="signal" size="sm" className="ml-2 align-middle">{item.note}</Badge>}
          </th>
          {intervals.map((interval) => (
            <Cell
              key={interval.id}
              item={item}
              interval={interval}
              unit={unit}
              applies={cells[`${item.id}:${interval.id}`] ?? false}
              review={interval.needsReview}
              onToggle={(next) => onToggleCell(item, interval, next)}
            />
          ))}
          {/* Separada de las casillas por su propio borde y espacio: un clic torpe en una casilla no quita el ítem. */}
          <td className="border-l border-[var(--color-border)] pl-3 pr-2 text-right">
            <button type="button" className={REMOVE_CLASS} onClick={() => onRemove(item)} aria-label={`Quitar ${item.name} de la pauta`}>Quitar</button>
          </td>
        </tr>
      ))}
      {!collapsed && !searching && (adding
        ? <AddItemRow group={group} colSpan={colSpan} busy={busy} onAdd={onAddItem} onClose={onStopAdd} />
        : (
          <tr>
            <td colSpan={colSpan} className="px-3 py-1">
              <button type="button" onClick={onStartAdd} className="min-h-9 rounded-md px-2 text-sm font-medium text-[var(--color-primary-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
                + Agregar ítem en {group.name}
              </button>
            </td>
          </tr>
        ))}
    </tbody>
  )
}
